import { useCallback, useEffect, useState } from 'react';
import { useNavigationController } from '@app/appServices';
import { filmRepository } from '@entities/film/film.repository';
import { resumeTarget } from '@domain/rating/rating.machine';
import type { FilmSnapshot } from '@domain/rating/rating.types';
import { useRatingStore, draftMatchesFilm, snapshotFromFilm } from '../model/rating.store';
import { replaceDraft, requestDraft } from '../model/draftCoordinator';
import { useJournalStore } from '@features/journal/model/journal.store';
import type { JournalEntry } from '@domain/journal/journal.types';
import { RatingFlowShell } from '../components/RatingFlowShell';
import { FilmIdentity } from '../components/FilmIdentity';
import { DraftConflictSheet } from '../components/DraftConflictSheet';
import { Skeleton } from '@shared/ui/Skeleton/Skeleton';
import { useRatingFlow } from '../model/useRatingFlow';
import styles from './RatingModeScreen.module.css';

export interface RatingModeScreenProps {
  filmId: number;
}

/**
 * Entry point of the flow (spec §6).
 *
 * Nothing is written here: opening the selector and leaving must not create an
 * empty draft. The draft appears only once a mode is chosen.
 */
export const RatingModeScreen = ({ filmId }: RatingModeScreenProps) => {
  const navigation = useNavigationController();
  const { openScreen } = useRatingFlow(filmId);

  const draft = useRatingStore((state) => state.draft);
  const hydrated = useRatingStore((state) => state.hydrated);

  const entries = useJournalStore((state) => state.entries);
  const existingEntry: JournalEntry | null =
    entries.find((entry) => entry.filmId === filmId) ?? null;

  const [film, setFilm] = useState<FilmSnapshot | null>(null);
  const [conflict, setConflict] = useState<{
    reason: 'film' | 'mode';
    mode: 'quick' | 'detailed';
  } | null>(null);

  /* The snapshot is taken from local data: the flow must work offline. */
  useEffect(() => {
    let active = true;
    if (existingEntry) {
      setFilm(existingEntry.film);
      return;
    }
    void filmRepository.getCached(filmId).then((cached) => {
      if (!active || !cached) return;
      setFilm(snapshotFromFilm(cached));
    });
    return () => {
      active = false;
    };
  }, [filmId, existingEntry]);

  const optionsFor = useCallback(
    (mode: 'quick' | 'detailed') => ({
      film: film!,
      mode,
      ...(existingEntry
        ? {
            editingEntryId: existingEntry.id,
            quickScore: mode === 'quick' ? existingEntry.quickScore : null,
            ...(existingEntry.aspects && mode === 'detailed'
              ? { aspects: existingEntry.aspects }
              : {}),
          }
        : {}),
    }),
    [film, existingEntry],
  );

  /**
   * Every start goes through the coordinator, so picking a mode can never wipe
   * an unfinished rating — neither another film's nor this film's own.
   */
  const begin = useCallback(
    async (mode: 'quick' | 'detailed') => {
      if (!film) return;
      const outcome = await requestDraft(optionsFor(mode));

      switch (outcome.kind) {
        case 'started':
        case 'resumed':
          openScreen(resumeTarget(outcome.draft), false);
          return;
        case 'conflict':
          setConflict({ reason: 'film', mode });
          return;
        case 'modeConflict':
          setConflict({ reason: 'mode', mode });
      }
    },
    [film, optionsFor, openScreen],
  );

  /** Only reachable from the confirmation sheet. */
  const beginAfterConfirm = useCallback(async () => {
    if (!film || !conflict) return;
    setConflict(null);
    const created = await replaceDraft(optionsFor(conflict.mode));
    openScreen(resumeTarget(created), false);
  }, [film, conflict, optionsFor, openScreen]);

  const resumeOwnDraft = useCallback(() => {
    if (!draft) return;
    openScreen(resumeTarget(draft), false);
  }, [draft, openScreen]);

  if (!hydrated || !film) {
    return (
      <RatingFlowShell onBack={() => navigation.goBack()}>
        <div className={styles.loading}>
          <Skeleton height={220} />
          <Skeleton height={72} />
          <Skeleton height={72} />
        </div>
      </RatingFlowShell>
    );
  }

  const ownDraft = draftMatchesFilm(draft, filmId) ? draft : null;
  const detailedTitle =
    existingEntry?.mode === 'detailed' ? 'Изменить оценку' : 'Разобрать впечатление';
  const quickTitle = existingEntry ? 'Изменить быструю оценку' : 'Быстрая оценка';

  return (
    <RatingFlowShell onBack={() => navigation.goBack()} accentRgb={film.dominantColor}>
      <div className={styles.content}>
        <FilmIdentity film={film} size="hero" />

        <h1 className={styles.question}>
          {existingEntry ? 'Что сделать с оценкой?' : 'Как хочешь оценить?'}
        </h1>

        {ownDraft ? (
          <button type="button" className={styles.resume} onClick={resumeOwnDraft}>
            <span className={styles.resumeTitle}>Продолжить оценку</span>
            <span className={styles.resumeHint}>Ты остановился на этом фильме</span>
          </button>
        ) : null}

        <div className={styles.options}>
          {/* The detailed path is the visually dominant one. */}
          <button
            type="button"
            className={styles.option}
            data-variant="primary"
            onClick={() => void begin('detailed')}
            aria-describedby="mode-detailed-hint"
            data-testid="mode-detailed"
          >
            <span className={styles.optionTitle}>{detailedTitle}</span>
            <span className={styles.optionHint} id="mode-detailed-hint">
              Пять вопросов — итог сложится сам
            </span>
          </button>

          {existingEntry?.mode !== 'detailed' ? (
            <button
              type="button"
              className={styles.option}
              data-variant="secondary"
              onClick={() => void begin('quick')}
              aria-describedby="mode-quick-hint"
              data-testid="mode-quick"
            >
              <span className={styles.optionTitle}>{quickTitle}</span>
              <span className={styles.optionHint} id="mode-quick-hint">
                Только пять звёзд
              </span>
            </button>
          ) : null}
        </div>
      </div>

      <DraftConflictSheet
        open={conflict !== null && draft !== null}
        draft={draft}
        reason={conflict?.reason ?? 'film'}
        onClose={() => setConflict(null)}
        onContinue={() => {
          setConflict(null);
          if (!draft) return;
          // Resume exactly where it was left, not on its mode selector.
          if (draftMatchesFilm(draft, filmId)) {
            openScreen(resumeTarget(draft), false);
            return;
          }
          navigation.openRating({ kind: 'rateMode', filmId: draft.film.filmId }, false);
        }}
        // Discarding continues straight into the mode the user picked.
        onDiscard={beginAfterConfirm}
      />
    </RatingFlowShell>
  );
};

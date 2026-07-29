import { useCallback, useEffect, useState } from 'react';
import { useNavigationController, useServices } from '@app/appServices';
import { filmRepository } from '@entities/film/film.repository';
import { MODE_LABELS, MODE_QUESTION } from '@domain/rating/rating.constants';
import { resumeTarget, type RatingFilmSummary } from '@domain/rating/rating.machine';
import type { RatingDraft, RatingMode } from '@domain/rating/rating.types';
import { useRatingStore, draftMatchesFilm, filmSummaryFrom } from '../model/rating.store';
import { replaceDraft, requestDraft } from '@features/drafts/draftCoordinator';
import { useDiaryStore } from '@features/diary/model/diary.store';
import type { DiaryEntry } from '@domain/diary/diary.types';
import { RatingFlowShell } from '../components/RatingFlowShell';
import { FilmIdentity } from '../components/FilmIdentity';
import { DraftConflictSheet } from '../components/DraftConflictSheet';
import { DuplicateFilmSheet } from '../components/DuplicateFilmSheet';
import { Button } from '@shared/ui/Button/Button';
import { Skeleton } from '@shared/ui/Skeleton/Skeleton';
import { useRatingFlow } from '../model/useRatingFlow';
import styles from './RatingModePage.module.css';

export interface RatingModePageProps {
  filmId: number;
}

/**
 * Entry point of the flow (spec §10).
 *
 * Nothing is written here: opening the chooser and leaving must not create an
 * empty draft. The draft appears only once a mode is chosen, and always through
 * the coordinator so no unfinished rating is ever destroyed silently.
 */
export const RatingModePage = ({ filmId }: RatingModePageProps) => {
  const navigation = useNavigationController();
  const { haptics } = useServices();
  const { openTarget } = useRatingFlow(filmId, 'mode');

  const draft = useRatingStore((state) => state.draft);
  const hydrated = useRatingStore((state) => state.hydrated);
  const chooseMode = useRatingStore((state) => state.chooseMode);

  const entries = useDiaryStore((state) => state.entries);
  const existingEntry: DiaryEntry | null = entries.find((entry) => entry.filmId === filmId) ?? null;

  const [film, setFilm] = useState<RatingFilmSummary | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [conflictMode, setConflictMode] = useState<RatingMode | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);

  /* The summary comes from local data: the flow must work offline. */
  useEffect(() => {
    let active = true;
    void filmRepository.getCached(filmId).then((cached) => {
      if (!active) return;
      if (cached) setFilm(filmSummaryFrom(cached));
      // Nothing cached and no network: say so instead of spinning forever.
      else setUnavailable(true);
    });
    return () => {
      active = false;
    };
  }, [filmId]);

  /* A film that is already rated asks what to do instead of duplicating. */
  useEffect(() => {
    if (existingEntry && !draftMatchesFilm(draft, filmId)) setDuplicateOpen(true);
  }, [existingEntry, draft, filmId]);

  const optionsFor = useCallback(
    (mode: RatingMode) => ({
      film: film!,
      mode,
      ...(existingEntry
        ? {
            editingEntryId: existingEntry.id,
            quickRating: mode === 'quick' ? existingEntry.overallRating : null,
            ...(mode === 'deep' && existingEntry.mode === 'deep'
              ? { aspects: existingEntry.aspects }
              : {}),
          }
        : {}),
    }),
    [film, existingEntry],
  );

  const begin = useCallback(
    async (mode: RatingMode) => {
      if (!film) return;
      haptics.trigger('ratingModeSelect', mode);

      const outcome = await requestDraft(optionsFor(mode));
      if (outcome.kind === 'conflict') {
        setConflictMode(mode);
        return;
      }
      // A resumed draft keeps whatever mode it already had unless it has none.
      if (outcome.kind === 'resumed' && outcome.draft.mode === null) await chooseMode(mode);
      else if (outcome.kind === 'started') await chooseMode(mode);

      const current = useRatingStore.getState().draft;
      if (current) openTarget(resumeTarget(current), false);
    },
    [film, optionsFor, openTarget, chooseMode, haptics],
  );

  /** Only reachable from the confirmation sheet. */
  const beginAfterConfirm = useCallback(async () => {
    if (!film || !conflictMode) return;
    const mode = conflictMode;
    setConflictMode(null);
    const created: RatingDraft = await replaceDraft(optionsFor(mode));
    await chooseMode(mode);
    openTarget(resumeTarget({ ...created, mode }), false);
  }, [film, conflictMode, optionsFor, openTarget, chooseMode]);

  if (unavailable && !film) {
    return (
      <RatingFlowShell onBack={() => navigation.goBack()}>
        <div className={styles.unavailable}>
          <p className={styles.unavailableText}>
            Не получилось открыть оценку: этот фильм ещё не сохранён на устройстве.
          </p>
          <Button variant="secondary" onClick={() => navigation.goBack()}>
            Вернуться к фильму
          </Button>
        </div>
      </RatingFlowShell>
    );
  }

  if (!hydrated || !film) {
    return (
      <RatingFlowShell onBack={() => navigation.goBack()}>
        <div className={styles.loading}>
          <Skeleton height={200} />
          <Skeleton height={92} />
          <Skeleton height={92} />
        </div>
      </RatingFlowShell>
    );
  }

  const ownDraft = draftMatchesFilm(draft, filmId) ? draft : null;

  return (
    <RatingFlowShell onBack={() => navigation.goBack()} accentRgb={film.dominantColor ?? undefined}>
      <div className={styles.content}>
        <FilmIdentity film={film} size="hero" />
        <h1 className={styles.question}>{MODE_QUESTION}</h1>

        {ownDraft?.mode ? (
          <button
            type="button"
            className={styles.resume}
            onClick={() => openTarget(resumeTarget(ownDraft), false)}
            data-testid="resume-draft"
          >
            <span className={styles.resumeTitle}>Продолжить</span>
            <span className={styles.resumeHint}>Ты остановился на этом фильме</span>
          </button>
        ) : null}

        <div className={styles.options}>
          {/* The deep path is the visually dominant one — quick is never wrong. */}
          <button
            type="button"
            className={styles.option}
            data-variant="primary"
            onClick={() => void begin('deep')}
            aria-describedby="mode-deep-hint"
            data-testid="mode-deep"
          >
            <span className={styles.optionTitle}>{MODE_LABELS.deep.title}</span>
            <span className={styles.optionHint} id="mode-deep-hint">
              {MODE_LABELS.deep.description}
            </span>
            <span className={styles.optionDuration}>{MODE_LABELS.deep.duration}</span>
          </button>

          <button
            type="button"
            className={styles.option}
            data-variant="secondary"
            onClick={() => void begin('quick')}
            aria-describedby="mode-quick-hint"
            data-testid="mode-quick"
          >
            <span className={styles.optionTitle}>{MODE_LABELS.quick.title}</span>
            <span className={styles.optionHint} id="mode-quick-hint">
              {MODE_LABELS.quick.description}
            </span>
            <span className={styles.optionDuration}>{MODE_LABELS.quick.duration}</span>
          </button>
        </div>
      </div>

      <DraftConflictSheet
        open={conflictMode !== null && draft !== null}
        draft={draft}
        onClose={() => setConflictMode(null)}
        onContinue={() => {
          setConflictMode(null);
          if (!draft) return;
          navigation.openRating({ kind: 'rateMode', filmId: draft.filmId }, false);
        }}
        onDiscard={beginAfterConfirm}
      />

      <DuplicateFilmSheet
        open={duplicateOpen && existingEntry !== null}
        entry={existingEntry}
        onClose={() => {
          setDuplicateOpen(false);
          navigation.goBack();
        }}
        onEdit={() => {
          setDuplicateOpen(false);
          if (existingEntry) void begin(existingEntry.mode);
        }}
        onOpenEntry={() => {
          setDuplicateOpen(false);
          if (existingEntry) navigation.openDiaryEntry(existingEntry.id);
        }}
      />
    </RatingFlowShell>
  );
};

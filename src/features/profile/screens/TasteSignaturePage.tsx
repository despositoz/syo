import { useCallback, useEffect } from 'react';
import { useNavigationController } from '@app/appServices';
import { useTelegram } from '@app/telegram/telegramStore';
import { summaryOf, type Film } from '@entities/film/film.model';
import { openFilmWithPreflight } from '@pages/film/filmOpening';
import { IconButton } from '@shared/ui/IconButton/IconButton';
import { BackIcon } from '@shared/ui/icons';
import { Button } from '@shared/ui/Button/Button';
import { RATING_ASPECTS } from '@domain/rating/rating.constants';
import { useProfileStore } from '../model/profile.store';
import {
  archiveLine,
  confidenceLine,
  genreLine,
  personLine,
  plural,
} from '../domain/taste-profile.templates';
import { ComparisonBars, SignalSection } from '../components/ProfileParts';
import styles from './TasteSignaturePage.module.css';

/**
 * The full taste signature (P0.5 §12).
 *
 * A long editorial read, not a dashboard: one clear conclusion per section, a
 * compact visualisation beside it, and the films behind it one tap away. A
 * section with no signal is simply absent.
 */
export const TasteSignaturePage = () => {
  const navigation = useNavigationController();
  const chromeMode = useTelegram().chromeMode;

  const snapshot = useProfileStore((state) => state.snapshot);
  const films = useProfileStore((state) => state.films);
  const hydrate = useProfileStore((state) => state.hydrate);
  const hydrated = useProfileStore((state) => state.hydrated);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const openFilm = useCallback(
    (film: Film) => openFilmWithPreflight(navigation, summaryOf(film)),
    [navigation],
  );

  const aspectName = (id: string) =>
    RATING_ASPECTS.find((aspect) => aspect.id === id)?.shortName ?? id;

  const computed = new Date(snapshot.computedAt).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  });

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        {chromeMode === 'custom' ? (
          <IconButton label="Назад" onClick={() => navigation.goBack()} data-testid="taste-back">
            <BackIcon />
          </IconButton>
        ) : (
          <span />
        )}
      </header>

      <div className={`${styles.scroll} scroll-y`} data-testid="taste-scroll">
        <main className={styles.content}>
          <p className={styles.eyebrow}>Почерк</p>
          <h1 className={styles.headline} data-testid="taste-page-headline">
            {snapshot.headline?.text ?? 'Твой почерк ещё складывается'}
          </h1>
          <p className={styles.confidence}>{confidenceLine(snapshot)}</p>

          {snapshot.confidence === 'insufficient' ? (
            <div className={styles.insufficient} data-testid="taste-insufficient">
              <p>
                Пока в Дневнике слишком мало оценок. Ничего не выдумываем — почерк появится, когда
                будет из чего его собрать.
              </p>
              <Button variant="primary" onClick={() => navigation.openPicker()}>
                Оценить фильм
              </Button>
            </div>
          ) : (
            <>
              {snapshot.aspectSignature ? (
                <SignalSection
                  title="Что тебя обычно цепляет"
                  conclusion={`Твою итоговую оценку чаще всего поднимает ${aspectName(snapshot.aspectSignature.leadAspect).toLowerCase()}. А ниже прочих у тебя обычно один аспект — ${aspectName(snapshot.aspectSignature.strictestAspect).toLowerCase()}.`}
                  evidenceKey={snapshot.aspectSignature.evidenceKey}
                  snapshot={snapshot}
                  films={films}
                  onOpenFilm={openFilm}
                >
                  {/* Five rays as plain bars — no radar web (§12). */}
                  <ComparisonBars
                    items={snapshot.aspectSignature.aspects.map((aspect) => ({
                      label: aspectName(aspect.aspect),
                      value: aspect.average,
                      caption: aspect.average.toFixed(1),
                    }))}
                  />
                </SignalSection>
              ) : null}

              {snapshot.genreSignals.length ? (
                <SignalSection
                  title="Жанровый ландшафт"
                  conclusion={
                    snapshot.genreSignals[0]!.kind === 'affinity'
                      ? `Выше остального у тебя держится ${snapshot.genreSignals[0]!.genre.toLowerCase()}.`
                      : `Один жанр ты выбираешь часто, но оцениваешь строже прочих — ${snapshot.genreSignals[0]!.genre.toLowerCase()}.`
                  }
                  evidenceKey={snapshot.genreSignals[0]!.evidenceKey}
                  snapshot={snapshot}
                  films={films}
                  onOpenFilm={openFilm}
                >
                  <ul className={styles.list}>
                    {snapshot.genreSignals.map((signal) => (
                      <li key={signal.genre} className={styles.listRow}>
                        <span>{genreLine(signal)}</span>
                        <span className={styles.number}>{signal.average.toFixed(1)}</span>
                      </li>
                    ))}
                  </ul>
                </SignalSection>
              ) : null}

              {snapshot.directorSignals.length || snapshot.actorSignals.length ? (
                <SignalSection
                  title="Кто повторяется в архиве"
                  conclusion={
                    snapshot.directorSignals[0]
                      ? `Чаще других в архиве повторяется один режиссёр — ${snapshot.directorSignals[0].name}.`
                      : `Одни и те же актёры возвращаются в твои сильные оценки.`
                  }
                  evidenceKey={
                    snapshot.directorSignals[0]?.evidenceKey ??
                    snapshot.actorSignals[0]?.evidenceKey ??
                    null
                  }
                  snapshot={snapshot}
                  films={films}
                  onOpenFilm={openFilm}
                >
                  <ul className={styles.list}>
                    {[...snapshot.directorSignals, ...snapshot.actorSignals].map((signal) => (
                      <li key={signal.evidenceKey} className={styles.listRow}>
                        <span>{personLine(signal)}</span>
                        <span className={styles.number}>{signal.average.toFixed(1)}</span>
                      </li>
                    ))}
                  </ul>
                </SignalSection>
              ) : null}

              {snapshot.ratingBehavior ? (
                <SignalSection
                  title="Как ты ставишь оценки"
                  conclusion={`Твоя средняя — ${snapshot.ratingBehavior.average.toFixed(1)}, и ${Math.round(snapshot.ratingBehavior.generousShare * 100)}% фильмов получают четвёрку или пятёрку.`}
                  evidenceKey={snapshot.ratingBehavior.evidenceKey}
                  snapshot={snapshot}
                  films={films}
                  onOpenFilm={openFilm}
                >
                  <ul className={styles.list}>
                    <li className={styles.listRow}>
                      <span>Быстрых оценок</span>
                      <span className={styles.number}>{snapshot.ratingBehavior.quickCount}</span>
                    </li>
                    <li className={styles.listRow}>
                      <span>Подробных оценок</span>
                      <span className={styles.number}>{snapshot.ratingBehavior.deepCount}</span>
                    </li>
                  </ul>
                </SignalSection>
              ) : null}

              {snapshot.writingSignature ? (
                <SignalSection
                  title="Как ты пишешь"
                  conclusion={`Ты сохраняешь текст к ${Math.round(snapshot.writingSignature.writtenShare * 100)}% записей, обычно около ${snapshot.writingSignature.medianLength} символов.`}
                  evidenceKey={snapshot.writingSignature.evidenceKey}
                  snapshot={snapshot}
                  films={films}
                  onOpenFilm={openFilm}
                />
              ) : null}

              {snapshot.eraPreference.length ? (
                <SignalSection
                  title="Из каких лет твои фильмы"
                  conclusion={`Чаще всего в архиве встречаются ${snapshot.eraPreference[0]!.decade}.`}
                  evidenceKey={snapshot.eraPreference[0]!.evidenceKey}
                  snapshot={snapshot}
                  films={films}
                  onOpenFilm={openFilm}
                >
                  <ComparisonBars
                    max={Math.max(...snapshot.eraPreference.map((era) => era.support))}
                    items={snapshot.eraPreference.map((era) => ({
                      label: era.decade,
                      value: era.support,
                      caption: `${era.support} ${plural(era.support, 'фильм', 'фильма', 'фильмов')}`,
                    }))}
                  />
                </SignalSection>
              ) : null}

              {snapshot.viewingRhythm ? (
                <SignalSection
                  title="Ритм архива"
                  conclusion={`За последние 30 дней — ${snapshot.viewingRhythm.last30Days} ${plural(snapshot.viewingRhythm.last30Days, 'запись', 'записи', 'записей')}.`}
                  evidenceKey={null}
                  snapshot={snapshot}
                  films={films}
                  onOpenFilm={openFilm}
                >
                  {snapshot.viewingRhythm.medianGapDays !== null ? (
                    <p className={styles.meta}>
                      Между записями обычно проходит около{' '}
                      {snapshot.viewingRhythm.medianGapDays.toFixed(0)} дней.
                    </p>
                  ) : null}
                </SignalSection>
              ) : null}

              <p className={styles.archive}>{archiveLine(snapshot)}</p>
            </>
          )}

          {/* The method, in plain words (§24). */}
          <section className={styles.method} data-testid="taste-method">
            <h2 className={styles.methodTitle}>Как это посчитано</h2>
            <p>
              Всё считается на этом устройстве из твоего Дневника: оценки, аспекты подробных оценок,
              жанры, режиссёры и актёры из кэша фильмов, даты записей.
            </p>
            <p>
              Текст твоих записей не читается и не анализируется — учитывается только то, есть он и
              какой он длины.
            </p>
            <p>Ничего из этого никуда не отправляется. Пересчитано {computed}.</p>
            <p className={styles.meta}>
              Почерк — производные данные: его можно удалить в настройках, и он соберётся заново.
            </p>
          </section>
        </main>
      </div>
    </section>
  );
};

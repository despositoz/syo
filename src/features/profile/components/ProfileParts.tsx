import { useEffect, useState } from 'react';
import type { EvidenceRef, TasteProfileSnapshot } from '../domain/taste-profile.model';
import { initialsOf, type LocalProfile } from '../domain/profile.model';
import { confidenceLine, plural } from '../domain/taste-profile.templates';
import type { Film } from '@entities/film/film.model';
import { Poster } from '@shared/ui/Poster/Poster';
import { Button } from '@shared/ui/Button/Button';
import { IconButton } from '@shared/ui/IconButton/IconButton';
import { CloseIcon } from '@shared/ui/icons';
import styles from './ProfileParts.module.css';

/**
 * The pieces the profile is built from (P0.5 §11).
 *
 * Quieter than the Film page and the Feed: images carry the colour, surfaces
 * are rare, and nothing here is a dashboard tile.
 */

/* --- identity ------------------------------------------------------------- */

export const IdentityBlock = ({
  profile,
  onEdit,
}: {
  profile: LocalProfile;
  onEdit: () => void;
}) => (
  <section className={styles.identity} data-testid="profile-identity">
    <div className={styles.avatar} aria-hidden="true">
      {profile.telegramPhotoUrl ? (
        <img src={profile.telegramPhotoUrl} alt="" width={80} height={80} />
      ) : (
        // Initials, never the SYO wordmark (§11.1).
        <span className={styles.initials}>{initialsOf(profile.displayName)}</span>
      )}
    </div>

    <div className={styles.identityBody}>
      <h1 className={styles.name} data-testid="profile-name">
        {profile.displayName}
      </h1>
      {profile.bio ? (
        <p className={styles.bio} data-testid="profile-bio">
          {profile.bio}
        </p>
      ) : null}
    </div>

    <Button variant="secondary" onClick={onEdit} data-testid="profile-edit">
      Изменить
    </Button>
  </section>
);

/* --- favourites ----------------------------------------------------------- */

export const FavoriteFilms = ({
  ids,
  films,
  onOpen,
  onEdit,
}: {
  ids: number[];
  films: Map<number, Film>;
  onOpen: (film: Film) => void;
  onEdit: () => void;
}) => (
  <section className={styles.section} data-testid="profile-favorites">
    <header className={styles.sectionHeader}>
      <h2 className={styles.sectionTitle}>Любимые фильмы</h2>
      <button
        type="button"
        className={styles.sectionAction}
        onClick={onEdit}
        data-testid="favorites-edit"
      >
        {ids.length ? 'Изменить' : 'Выбрать'}
      </button>
    </header>

    {ids.length ? (
      <ul className={styles.favoriteRow}>
        {ids.map((id) => {
          const film = films.get(id);
          return (
            <li key={id}>
              <button
                type="button"
                className={styles.favorite}
                onClick={() => film && onOpen(film)}
                aria-label={film ? `${film.title}, любимый фильм` : 'Фильм из списка'}
                data-testid="favorite-film"
              >
                <span className={styles.favoritePoster} data-poster-frame="">
                  <Poster
                    title={film?.title ?? 'Фильм'}
                    year={film?.year ?? ''}
                    posterPath={film?.posterPath ?? ''}
                    accent={film?.accent}
                    requestWidth={185}
                    decorative
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    ) : (
      <p className={styles.empty}>
        Пять фильмов, по которым тебя можно узнать. Они останутся только у тебя.
      </p>
    )}
  </section>
);

/* --- taste hero ----------------------------------------------------------- */

export const TasteSignatureHero = ({
  snapshot,
  films,
  onOpen,
}: {
  snapshot: TasteProfileSnapshot;
  films: Map<number, Film>;
  onOpen: () => void;
}) => {
  // Two or three posters from whatever the headline actually rests on.
  const evidence = (snapshot.headline?.evidenceKeys ?? [])
    .flatMap((key) => snapshot.evidenceIndex[key] ?? [])
    .slice(0, 3);

  return (
    <section className={styles.hero} data-testid="taste-hero">
      <p className={styles.eyebrow}>Почерк</p>

      {snapshot.confidence === 'insufficient' ? (
        <>
          <h2 className={styles.headline}>Здесь появится твой почерк</h2>
          <p className={styles.heroHint}>
            Пока слишком мало оценок, чтобы что-то утверждать. Оцени ещё пару фильмов.
          </p>
        </>
      ) : (
        <>
          <h2 className={styles.headline} data-testid="taste-headline">
            {snapshot.headline?.text}
          </h2>
          <p className={styles.heroHint} data-testid="taste-confidence">
            {confidenceLine(snapshot)}
          </p>

          {evidence.length ? (
            <ul className={styles.heroPosters} aria-hidden="true">
              {evidence.map((ref) => (
                <li key={ref.filmId} className={styles.heroPoster} data-poster-frame="">
                  <Poster
                    title={ref.title}
                    posterPath={ref.posterPath ?? ''}
                    accent={films.get(ref.filmId)?.accent}
                    requestWidth={92}
                    decorative
                  />
                </li>
              ))}
            </ul>
          ) : null}

          <Button variant="secondary" block onClick={onOpen} data-testid="taste-open">
            Посмотреть полностью
          </Button>
        </>
      )}
    </section>
  );
};

/* --- evidence ------------------------------------------------------------- */

/**
 * Why a conclusion exists (§13). Plain language and real films: no weights,
 * no algorithm names, no JSON.
 */
export const EvidenceList = ({
  refs,
  films,
  onOpenFilm,
}: {
  refs: EvidenceRef[];
  films: Map<number, Film>;
  onOpenFilm: (film: Film) => void;
}) => (
  <ul className={styles.evidence} data-testid="evidence-list">
    {refs.map((ref) => {
      const film = films.get(ref.filmId);
      return (
        <li key={`${ref.diaryEntryId}:${ref.filmId}`}>
          <button
            type="button"
            className={styles.evidenceRow}
            onClick={() => film && onOpenFilm(film)}
            disabled={!film}
            data-testid="evidence-film"
          >
            <span className={styles.evidencePoster} data-poster-frame="">
              <Poster
                title={ref.title}
                posterPath={ref.posterPath ?? ''}
                accent={film?.accent}
                requestWidth={92}
                decorative
              />
            </span>

            <span className={styles.evidenceBody}>
              <span className={styles.evidenceTitle}>{ref.title}</span>
              <span className={styles.evidenceMeta}>
                Твоя оценка {ref.rating} · {ref.reason}
              </span>
            </span>

            {/* The bar carries the same fact as the number beside it (§29.9). */}
            <span className={styles.contribution} aria-hidden="true">
              <span style={{ width: `${Math.round(ref.contribution * 100)}%` }} />
            </span>
          </button>
        </li>
      );
    })}
  </ul>
);

/* --- shared section shell -------------------------------------------------- */

export const SignalSection = ({
  title,
  conclusion,
  evidenceKey,
  snapshot,
  films,
  onOpenFilm,
  children,
}: {
  title: string;
  conclusion: string;
  evidenceKey: string | null;
  snapshot: TasteProfileSnapshot;
  films: Map<number, Film>;
  onOpenFilm: (film: Film) => void;
  children?: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const refs = evidenceKey ? (snapshot.evidenceIndex[evidenceKey] ?? []) : [];

  return (
    <section className={styles.signal} data-testid="taste-section">
      <h3 className={styles.signalTitle}>{title}</h3>
      <p className={styles.signalConclusion}>{conclusion}</p>
      {children}

      {refs.length ? (
        <>
          <button
            type="button"
            className={styles.why}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            data-testid="taste-why"
          >
            {open ? 'Скрыть' : 'Почему?'}
          </button>
          {open ? (
            <div className={styles.whyBody}>
              <p className={styles.signalMeta}>
                Посчитано по {refs.length} {plural(refs.length, 'фильму', 'фильмам', 'фильмам')} из
                твоего Дневника
              </p>
              <EvidenceList refs={refs} films={films} onOpenFilm={onOpenFilm} />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
};

/* --- comparison bars ------------------------------------------------------- */

/** A row of bars with the number always written out beside it (§23). */
export const ComparisonBars = ({
  items,
  max = 5,
}: {
  items: Array<{ label: string; value: number; caption?: string }>;
  max?: number;
}) => (
  <ul className={styles.bars}>
    {items.map((item) => (
      <li key={item.label} className={styles.bar}>
        <span className={styles.barLabel}>{item.label}</span>
        <span className={styles.barTrack} aria-hidden="true">
          <span style={{ width: `${Math.round((item.value / max) * 100)}%` }} />
        </span>
        <span className={styles.barValue}>{item.caption ?? item.value.toFixed(1)}</span>
      </li>
    ))}
  </ul>
);

/* --- favourites editor ----------------------------------------------------- */

/**
 * Reordering without a drag (§14.3, §23). The buttons are the accessible path
 * and also the only one a keyboard user has; the drag is an accelerator.
 */
export const FavoriteEditorRow = ({
  film,
  index,
  total,
  onMove,
  onRemove,
}: {
  film: Film | undefined;
  index: number;
  total: number;
  onMove: (to: number) => void;
  onRemove: () => void;
}) => (
  <li className={styles.editorRow} data-testid="favorite-editor-row">
    <span className={styles.editorPoster} data-poster-frame="">
      <Poster
        title={film?.title ?? 'Фильм'}
        posterPath={film?.posterPath ?? ''}
        accent={film?.accent}
        requestWidth={92}
        decorative
      />
    </span>

    <span className={styles.editorTitle}>{film?.title ?? 'Фильм'}</span>

    <span className={styles.editorControls}>
      <IconButton
        label="Переместить левее"
        variant="plain"
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
        data-testid="favorite-move-left"
      >
        <span aria-hidden="true">←</span>
      </IconButton>
      <IconButton
        label="Переместить правее"
        variant="plain"
        disabled={index === total - 1}
        onClick={() => onMove(index + 1)}
        data-testid="favorite-move-right"
      >
        <span aria-hidden="true">→</span>
      </IconButton>
      <IconButton
        label="Убрать из любимых"
        variant="plain"
        onClick={onRemove}
        data-testid="favorite-remove"
      >
        <CloseIcon />
      </IconButton>
    </span>
  </li>
);

/**
 * Announces a saved setting once, without stealing focus (§23).
 *
 * The message is cleared on a timer so the region does not keep repeating an
 * old announcement; the clearing is the only state this owns.
 */
export const SavedAnnouncer = ({ message }: { message: string | null }) => {
  const [cleared, setCleared] = useState<string | null>(null);

  useEffect(() => {
    if (!message || cleared === message) return;
    const timer = setTimeout(() => setCleared(message), 1800);
    return () => clearTimeout(timer);
  }, [message, cleared]);

  return (
    <span className="sr-only" role="status" aria-live="polite">
      {message && cleared !== message ? message : ''}
    </span>
  );
};

import type { RatingFilmSummary } from '@domain/rating/rating.machine';
import { Poster } from '@shared/ui/Poster/Poster';
import styles from './FilmIdentity.module.css';

export interface FilmIdentityProps {
  film: RatingFilmSummary;
  size?: 'hero' | 'compact';
}

/**
 * Poster plus full title — the only film context inside the rating flow.
 *
 * No backdrop, no TMDB score, no director, no overview: the flow is about the
 * user's own impression, not about the catalogue (spec §6.3, §8.2).
 */
export const FilmIdentity = ({ film, size = 'compact' }: FilmIdentityProps) => (
  <div className={styles.identity} data-size={size}>
    <div className={styles.poster}>
      <Poster
        title={film.filmTitle}
        year={film.releaseYear ?? ''}
        posterPath={film.posterPath ?? ''}
        accent={{ hex: '#6f2a35', rgb: film.dominantColor ?? '111, 42, 53' }}
        width={size === 'hero' ? 168 : 56}
        decorative
      />
    </div>
    {/* Full title, wrapped rather than truncated on the key screens. */}
    <p className={styles.title}>{film.filmTitle}</p>
  </div>
);

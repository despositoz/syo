import type { FilmSummary } from '@entities/film/film.model';
import { formatRating } from '@entities/film/film.model';
import { Poster } from '@shared/ui/Poster/Poster';
import { joinMeta } from '@shared/utils/text';
import styles from './CompactCard.module.css';

export interface CompactCardProps {
  film: FilmSummary;
  onOpen: (film: FilmSummary) => void;
}

const POSTER_WIDTH = 84;

export const CompactCard = ({ film, onOpen }: CompactCardProps) => (
  <button type="button" className={styles.card} onClick={() => onOpen(film)}>
    <span className={styles.poster} data-poster-frame="">
      <Poster
        title={film.title}
        year={film.year}
        posterPath={film.posterPath}
        accent={film.accent}
        requestWidth={POSTER_WIDTH}
        decorative
      />
    </span>
    <span className={styles.body}>
      <span className={styles.title}>{film.title}</span>
      <span className={styles.meta}>{joinMeta([film.year, film.genres[0]])}</span>
      {film.rating > 0 ? (
        <span className={styles.rating}>
          <span aria-hidden="true">★</span> {formatRating(film.rating)}
          <span className="sr-only"> — рейтинг TMDB</span>
        </span>
      ) : null}
    </span>
  </button>
);

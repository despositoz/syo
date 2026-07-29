import type { FilmSummary } from '@entities/film/film.model';
import { Poster } from '@shared/ui/Poster/Poster';
import { joinMeta } from '@shared/utils/text';
import styles from './ResultRow.module.css';

export interface ResultRowProps {
  film: FilmSummary;
  onSelect: (film: FilmSummary) => void;
}

const POSTER_WIDTH = 60;

export const ResultRow = ({ film, onSelect }: ResultRowProps) => (
  <li>
    <button type="button" className={styles.row} onClick={() => onSelect(film)}>
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
        <span className={styles.meta}>
          {joinMeta([film.year, film.originalTitle !== film.title ? film.originalTitle : ''])}
        </span>
      </span>
    </button>
  </li>
);

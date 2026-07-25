import { useId, useState } from 'react';
import type { Film } from '@entities/film/film.model';
import { formatRuntime } from '@entities/film/film.model';
import { ChevronDownIcon } from '@shared/ui/icons';
import styles from './FilmDetails.module.css';

export interface FilmDetailsProps {
  film: Film;
}

const money = (value: number): string =>
  value > 0 ? `${new Intl.NumberFormat('ru-RU').format(value)} $` : '';

/** Expandable details. Missing values are dropped, never rendered as "—". */
export const FilmDetails = ({ film }: FilmDetailsProps) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const rows: Array<[string, string]> = [
    ['Оригинальное название', film.originalTitle !== film.title ? film.originalTitle : ''],
    ['Режиссёр', film.director],
    ['Хронометраж', formatRuntime(film.runtime)],
    ['Жанры', film.genres.join(', ')],
    ['Страна', film.countries.join(', ')],
    ['Студия', film.productionCompanies.slice(0, 2).join(', ')],
    ['Бюджет', money(film.budget)],
    ['Сборы', money(film.revenue)],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  if (!rows.length) return null;

  return (
    <section className={styles.section}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>Подробности</span>
        <span className={styles.chevron} data-open={open} aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </button>

      {open ? (
        <dl className={styles.list} id={panelId}>
          {rows.map(([label, value]) => (
            <div className={styles.row} key={label}>
              <dt className={styles.label}>{label}</dt>
              <dd className={styles.value}>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
};

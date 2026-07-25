import type { FilmCastMember } from '@entities/film/film.model';
import { imagePipeline } from '@shared/images/ImagePipeline';
import styles from './FilmCast.module.css';

export interface FilmCastProps {
  cast: FilmCastMember[];
}

const AVATAR_WIDTH = 72;

/** A cast failure hides the block; it never replaces the screen (spec §25). */
export const FilmCast = ({ cast }: FilmCastProps) => {
  if (!cast.length) return null;

  return (
    <section className={styles.section} aria-labelledby="film-cast-title">
      <h2 className={styles.title} id="film-cast-title">
        В ролях
      </h2>
      <ul className={`${styles.list} scroll-y`}>
        {cast.map((person) => (
          <li key={person.id} className={styles.person}>
            <img
              className={styles.avatar}
              src={imagePipeline.profile(person.profilePath, AVATAR_WIDTH)}
              alt=""
              aria-hidden="true"
              width={AVATAR_WIDTH}
              height={AVATAR_WIDTH}
              loading="lazy"
              decoding="async"
              onError={(event) => {
                event.currentTarget.style.visibility = 'hidden';
              }}
            />
            <span className={styles.name}>{person.name}</span>
            {person.character ? <span className={styles.character}>{person.character}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
};

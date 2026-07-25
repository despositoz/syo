import type { FilmPresentation } from '../film.presentation';
import styles from './FilmTitleGroup.module.css';

export interface FilmTitleGroupProps {
  title: string;
  presentation: FilmPresentation | null;
}

/**
 * The title group is decided by the preflight and then frozen (spec §17).
 *
 * While the presentation is still resolving nothing visible is rendered — that
 * is what prevents the text→logo flash. The accessible title stays in the DOM
 * in every mode (spec §18).
 */
export const FilmTitleGroup = ({ title, presentation }: FilmTitleGroupProps) => {
  const mode = presentation?.titleMode ?? 'pending';

  return (
    <div className={styles.group} data-mode={mode}>
      {/*
        Screen readers always get the real title — with a logo, and while the
        preflight is still deciding. Only the *painted* form is deferred.
      */}
      <h1 className={mode === 'text' ? styles.text : 'sr-only'} data-testid="film-title">
        {title}
      </h1>

      {mode === 'logo' && presentation ? (
        <img
          className={styles.logo}
          src={presentation.logoUrl}
          alt=""
          aria-hidden="true"
          data-tone={presentation.logoTone}
          style={{ filter: presentation.logoFilter }}
          decoding="async"
        />
      ) : null}
    </div>
  );
};

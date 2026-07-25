import { useRef, type RefObject } from 'react';
import type { FilmSummary } from '@entities/film/film.model';
import { formatRating } from '@entities/film/film.model';
import { ImageStage } from '@shared/ui/ImageStage/ImageStage';
import { useCardParallax } from '@shared/utils/parallax';
import { usePerformanceStore } from '@app/performance/PerformanceController';
import { joinMeta } from '@shared/utils/text';
import styles from './CinematicCard.module.css';

export interface CinematicCardProps {
  film: FilmSummary;
  scrollRef: RefObject<HTMLElement | null>;
  onOpen: (film: FilmSummary) => void;
}

/**
 * The large card. Only the image layer moves with parallax; the text block is
 * stable, and the image has overscan so no edge is ever exposed (spec §20).
 * The poster carries no SYO wordmark (spec §12).
 */
export const CinematicCard = ({ film, scrollRef, onOpen }: CinematicCardProps) => {
  const cardRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const parallaxEnabled = usePerformanceStore((state) => state.parallaxEnabled);
  const reducedMotion = usePerformanceStore((state) => state.reducedMotion);

  useCardParallax(scrollRef, cardRef, layerRef, {
    // Reduce Motion keeps a minimal hero depth instead of removing it.
    amplitude: reducedMotion ? 8 : 30,
    enabled: parallaxEnabled,
  });

  const meta = joinMeta([film.year, film.genres[0], formatRating(film.rating)]);

  return (
    <button ref={cardRef} type="button" className={styles.card} onClick={() => onOpen(film)}>
      <span className={styles.media}>
        <ImageStage
          path={film.backdropPath || film.posterPath}
          kind={film.backdropPath ? 'backdrop' : 'poster'}
          accent={film.accent}
          width={520}
          priority
          layerRef={layerRef}
          overscan={1.16}
        />
        <span className={styles.scrim} aria-hidden="true" />
      </span>
      <span className={styles.content}>
        <span className={styles.title}>{film.title}</span>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </span>
    </button>
  );
};

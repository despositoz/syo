import { useEffect, useMemo, useRef, useState } from 'react';
import { imagePipeline } from '@shared/images/ImagePipeline';
import { DEFAULT_ACCENT, type AccentColor } from '@entities/film/film.model';
import styles from './Poster.module.css';

export interface PosterProps {
  title: string;
  year?: string;
  posterPath?: string;
  accent?: AccentColor;
  /**
   * Which TMDB size to fetch and what intrinsic dimensions the <img> declares.
   * It is a *hint about pixels*, never a layout instruction: the poster always
   * fills the frame its parent gives it (P0.3.1 §4).
   */
  requestWidth: number;
  /** Above-the-fold posters skip lazy loading. */
  priority?: boolean;
  className?: string;
  /** Decorative when the title is already announced next to it. */
  decorative?: boolean;
}

type Stage = 'color' | 'preview' | 'full' | 'fallback';

/**
 * Poster states (spec §13): dominant colour → blurred thumbnail → full image,
 * with a typographic fallback that carries the title and year — no error icon,
 * and never the word SYO.
 */
export const Poster = ({
  title,
  year,
  posterPath,
  accent = DEFAULT_ACCENT,
  requestWidth,
  priority = false,
  className,
  decorative = false,
}: PosterProps) => {
  const [stage, setStage] = useState<Stage>(posterPath ? 'color' : 'fallback');
  const mounted = useRef(true);

  const previewUrl = useMemo(
    () => (posterPath ? imagePipeline.preview(posterPath, 'poster') : ''),
    [posterPath],
  );
  const fullUrl = useMemo(
    () => (posterPath ? imagePipeline.poster(posterPath, requestWidth) : ''),
    [posterPath, requestWidth],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /*
   * A new film means a new stage. Adjusted during render rather than in an
   * effect: an effect would paint one frame of the previous poster's stage
   * first, and an already-decoded URL must not flash through 'color' again.
   */
  const [shownUrl, setShownUrl] = useState(fullUrl);
  if (shownUrl !== fullUrl) {
    setShownUrl(fullUrl);
    setStage(!posterPath ? 'fallback' : imagePipeline.isDecoded(fullUrl) ? 'full' : 'color');
  }

  // Intrinsic attributes only: they give the browser the ratio before the
  // bytes arrive. CSS never reads them.
  const height = Math.round((requestWidth * 3) / 2);

  return (
    <div
      className={[styles.poster, className].filter(Boolean).join(' ')}
      /*
       * No width here, ever. The frame around this element owns the geometry;
       * a fixed inline width was what pushed diary posters out of their grid
       * tracks and on top of each other (P0.3.1 §1).
       */
      style={{
        ['--poster-accent' as string]: accent.hex,
        ['--poster-accent-rgb' as string]: accent.rgb,
      }}
      data-stage={stage}
      data-poster-root=""
    >
      {previewUrl && stage !== 'fallback' ? (
        <img
          className={styles.preview}
          src={previewUrl}
          alt=""
          aria-hidden="true"
          width={requestWidth}
          height={height}
          decoding="async"
          loading={priority ? 'eager' : 'lazy'}
          onLoad={() =>
            mounted.current && setStage((current) => (current === 'color' ? 'preview' : current))
          }
          onError={() => {
            /* Preview failure is silent: the colour layer still holds the frame. */
          }}
        />
      ) : null}

      {fullUrl && stage !== 'fallback' ? (
        <img
          className={styles.full}
          src={fullUrl}
          alt={decorative ? '' : `Постер фильма «${title}»`}
          aria-hidden={decorative || undefined}
          width={requestWidth}
          height={height}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          loading={priority ? 'eager' : 'lazy'}
          onLoad={() => mounted.current && setStage('full')}
          onError={() => mounted.current && setStage('fallback')}
        />
      ) : null}

      {stage === 'fallback' ? (
        <div className={styles.fallback} role={decorative ? 'presentation' : undefined}>
          <span className={styles.fallbackTitle}>{title}</span>
          {year ? <span className={styles.fallbackYear}>{year}</span> : null}
        </div>
      ) : null}
    </div>
  );
};

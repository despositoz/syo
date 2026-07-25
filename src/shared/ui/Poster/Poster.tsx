import { useEffect, useMemo, useRef, useState } from 'react';
import { imagePipeline } from '@shared/images/ImagePipeline';
import { DEFAULT_ACCENT, type AccentColor } from '@entities/film/film.model';
import styles from './Poster.module.css';

export interface PosterProps {
  title: string;
  year?: string;
  posterPath?: string;
  accent?: AccentColor;
  /** CSS width; height follows the fixed 2:3 ratio, so layout never shifts. */
  width: number;
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
  width,
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
    () => (posterPath ? imagePipeline.poster(posterPath, width) : ''),
    [posterPath, width],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!posterPath) {
      setStage('fallback');
      return;
    }
    // An already-decoded URL must not flash through the preview stage again.
    setStage(imagePipeline.isDecoded(fullUrl) ? 'full' : 'color');
  }, [posterPath, fullUrl]);

  const height = Math.round((width * 3) / 2);

  return (
    <div
      className={[styles.poster, className].filter(Boolean).join(' ')}
      style={{
        width: `${width}px`,
        aspectRatio: '2 / 3',
        ['--poster-accent' as string]: accent.hex,
        ['--poster-accent-rgb' as string]: accent.rgb,
      }}
      data-stage={stage}
    >
      {previewUrl && stage !== 'fallback' ? (
        <img
          className={styles.preview}
          src={previewUrl}
          alt=""
          aria-hidden="true"
          width={width}
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
          width={width}
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

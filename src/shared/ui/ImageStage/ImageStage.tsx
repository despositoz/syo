import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { imagePipeline } from '@shared/images/ImagePipeline';
import { DEFAULT_ACCENT, type AccentColor } from '@entities/film/film.model';
import styles from './ImageStage.module.css';

export type ImageStageStatus = 'color' | 'preview' | 'full' | 'failed';

export interface ImageStageProps {
  path: string;
  kind: 'backdrop' | 'poster';
  accent?: AccentColor;
  /** Rendered width in CSS px, used to pick a TMDB size. */
  width: number;
  alt?: string;
  priority?: boolean;
  className?: string;
  /**
   * Ref to the moving layer. Parallax writes transforms here — never on the
   * container, so text above it stays stable.
   */
  layerRef?: Ref<HTMLDivElement>;
  /** Extra scale so a parallax shift never exposes an empty edge. */
  overscan?: number;
  onStatusChange?: (status: ImageStageStatus) => void;
}

/**
 * A media layer that always has something to show: accent colour, then a
 * blurred preview, then the full image. Failure is not an error screen —
 * the colour layer simply stays (spec §25).
 */
export const ImageStage = ({
  path,
  kind,
  accent = DEFAULT_ACCENT,
  width,
  alt = '',
  priority = false,
  className,
  layerRef,
  overscan = 1,
  onStatusChange,
}: ImageStageProps) => {
  const [status, setStatus] = useState<ImageStageStatus>(path ? 'color' : 'failed');
  const notify = useRef(onStatusChange);
  useEffect(() => {
    notify.current = onStatusChange;
  }, [onStatusChange]);

  const previewUrl = useMemo(() => (path ? imagePipeline.preview(path, kind) : ''), [path, kind]);
  const fullUrl = useMemo(
    () => (path ? imagePipeline.url(path, kind, width) : ''),
    [path, kind, width],
  );

  /*
   * A new image means a new status, adjusted during render: an effect would
   * show one frame of the previous image's status before correcting itself.
   */
  const [shownUrl, setShownUrl] = useState(fullUrl);
  if (shownUrl !== fullUrl) {
    setShownUrl(fullUrl);
    setStatus(!path ? 'failed' : imagePipeline.isDecoded(fullUrl) ? 'full' : 'color');
  }

  const update = (next: ImageStageStatus) => {
    setStatus((current) => {
      if (current === 'full' && next === 'preview') return current;
      if (current !== next) notify.current?.(next);
      return next;
    });
  };

  return (
    <div className={[styles.stage, className].filter(Boolean).join(' ')} data-status={status}>
      <div
        className={styles.layer}
        ref={layerRef}
        style={{
          ['--stage-accent-rgb' as string]: accent.rgb,
          ['--stage-overscan' as string]: String(overscan),
        }}
      >
        <div className={styles.color} />
        {previewUrl ? (
          <img
            className={styles.preview}
            src={previewUrl}
            alt=""
            aria-hidden="true"
            decoding="async"
            loading={priority ? 'eager' : 'lazy'}
            onLoad={() => update('preview')}
          />
        ) : null}
        {fullUrl ? (
          <img
            className={styles.full}
            src={fullUrl}
            alt={alt}
            aria-hidden={alt ? undefined : true}
            decoding="async"
            fetchPriority={priority ? 'high' : 'auto'}
            loading={priority ? 'eager' : 'lazy'}
            onLoad={() => update('full')}
            onError={() => update('failed')}
          />
        ) : null}
      </div>
    </div>
  );
};

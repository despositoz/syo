import { tmdbConfig } from '@shared/api/tmdb/tmdb.client';

/**
 * The only place that knows TMDB image URL rules.
 * Components ask for "a poster for this width", never for a size token.
 */

export type ImageKind = 'poster' | 'backdrop' | 'profile' | 'logo';

const SIZES: Record<ImageKind, readonly number[]> = {
  // TMDB width buckets, ascending.
  poster: [92, 154, 185, 342, 500, 780],
  backdrop: [300, 780, 1280],
  profile: [45, 185, 632],
  logo: [45, 92, 154, 185, 300, 500],
};

/** Smallest bucket that still covers the requested device pixels. */
export const pickSize = (kind: ImageKind, cssWidth: number, dpr = 1): number => {
  const target = Math.max(1, Math.round(cssWidth * Math.min(dpr, 3)));
  const buckets = SIZES[kind];
  const bucket = buckets.find((size) => size >= target);
  return bucket ?? buckets[buckets.length - 1] ?? 500;
};

export interface ImageSourceOptions {
  /** CSS width the image will occupy. */
  width: number;
  dpr?: number;
  kind?: ImageKind;
}

export class ImagePipeline {
  private readonly decoded = new Set<string>();

  constructor(
    private readonly base: string = tmdbConfig.imageBase,
    private readonly getDpr: () => number = () =>
      typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  ) {}

  /** Absolute URL for a TMDB path, or '' when there is nothing to show. */
  url(path: string, kind: ImageKind, cssWidth: number): string {
    if (!path) return '';
    if (/^https?:\/\//.test(path)) return path;
    const size = pickSize(kind, cssWidth, this.getDpr());
    return `${this.base}/w${size}${path.startsWith('/') ? path : `/${path}`}`;
  }

  /** Tiny blurred preview shown before the full image decodes. */
  preview(path: string, kind: ImageKind): string {
    if (!path) return '';
    const size = kind === 'backdrop' ? 300 : 92;
    return `${this.base}/w${size}${path.startsWith('/') ? path : `/${path}`}`;
  }

  poster(path: string, cssWidth: number): string {
    return this.url(path, 'poster', cssWidth);
  }

  backdrop(path: string, cssWidth: number): string {
    return this.url(path, 'backdrop', cssWidth);
  }

  profile(path: string, cssWidth: number): string {
    return this.url(path, 'profile', cssWidth);
  }

  logo(path: string, cssWidth: number): string {
    return this.url(path, 'logo', cssWidth);
  }

  /** True when this exact URL already decoded in this session (no flash). */
  isDecoded(url: string): boolean {
    return this.decoded.has(url);
  }

  /**
   * Loads and decodes an image off the main paint path.
   * Posters are always requested before backdrops (spec §22).
   */
  async load(
    url: string,
    options: { crossOrigin?: boolean; signal?: AbortSignal } = {},
  ): Promise<HTMLImageElement> {
    if (!url) throw new Error('empty image url');
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      if (options.crossOrigin) image.crossOrigin = 'anonymous';
      image.decoding = 'async';

      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
        options.signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        image.src = '';
        reject(new DOMException('aborted', 'AbortError'));
      };

      image.onload = () => {
        const finish = () => {
          this.decoded.add(url);
          cleanup();
          resolve(image);
        };
        // decode() may be missing (older WebViews) or reject on a detached image;
        // either way the bitmap is loaded and safe to show.
        if (typeof image.decode === 'function') {
          image.decode().then(finish, finish);
        } else {
          finish();
        }
      };
      image.onerror = () => {
        cleanup();
        reject(new Error(`image failed: ${url}`));
      };

      options.signal?.addEventListener('abort', onAbort, { once: true });
      image.src = url;
    });
  }
}

export const imagePipeline = new ImagePipeline();

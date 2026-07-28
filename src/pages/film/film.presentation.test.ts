import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  prepareFilmPresentation,
  prepareFilmPresentationCached,
  type PresentationPipeline,
} from './film.presentation';
import { emptyFilm, type Film, type FilmLogoCandidate } from '@entities/film/film.model';
import type { CanvasFactory } from '@shared/images/logoClassifier';
import { db } from '@shared/storage/db';

const logoCandidate = (overrides: Partial<FilmLogoCandidate> = {}): FilmLogoCandidate => ({
  filePath: '/logo.png',
  language: 'ru',
  width: 800,
  height: 260,
  aspectRatio: 3.07,
  voteAverage: 6,
  voteCount: 10,
  ...overrides,
});

const film = (overrides: Partial<Film> = {}): Film => ({
  ...emptyFilm(1, 'Тестовый фильм'),
  year: '2024',
  posterPath: '/poster.jpg',
  backdropPath: '/backdrop.jpg',
  detailed: true,
  ...overrides,
});

const fakeImage = { naturalWidth: 300, naturalHeight: 100 } as HTMLImageElement;

const pipeline = (
  load: PresentationPipeline['load'] = () => Promise.resolve(fakeImage),
): PresentationPipeline => ({
  preview: (path: string) => (path ? `preview${path}` : ''),
  poster: (path: string) => (path ? `poster${path}` : ''),
  backdrop: (path: string) => (path ? `backdrop${path}` : ''),
  logo: (path: string) => (path ? `logo${path}` : ''),
  load,
});

/** Canvas that always returns pixels of one colour. */
const canvasOf =
  (rgba: [number, number, number, number]): CanvasFactory =>
  (width, height) => ({
    canvas: {} as HTMLCanvasElement,
    context: {
      clearRect: () => {},
      drawImage: () => {},
      getImageData: () => {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let index = 0; index < width * height; index += 1) {
          data[index * 4] = rgba[0];
          data[index * 4 + 1] = rgba[1];
          data[index * 4 + 2] = rgba[2];
          data[index * 4 + 3] = rgba[3];
        }
        return { data };
      },
    } as unknown as CanvasRenderingContext2D,
  });

describe('film presentation preflight', () => {
  beforeEach(async () => {
    await db.presentations.clear();
  });

  it('returns an immutable object', async () => {
    const presentation = await prepareFilmPresentation(film(), { pipeline: pipeline() });
    expect(Object.isFrozen(presentation)).toBe(true);
  });

  it('prepares poster and backdrop previews', async () => {
    const presentation = await prepareFilmPresentation(film(), { pipeline: pipeline() });

    expect(presentation.posterPreviewUrl).toBe('preview/poster.jpg');
    expect(presentation.posterUrl).toBe('poster/poster.jpg');
    expect(presentation.backdropPreviewUrl).toBe('preview/backdrop.jpg');
  });

  it('never substitutes the poster for a missing backdrop', async () => {
    const presentation = await prepareFilmPresentation(film({ backdropPath: '' }), {
      pipeline: pipeline(),
    });

    // A 2:3 poster stretched across a landscape stage is worse than no image:
    // the stage must stay on its atmospheric colour fallback instead.
    expect(presentation.backdropUrl).toBe('');
    expect(presentation.backdropPreviewUrl).toBe('');
    expect(presentation.posterUrl).toBe('poster/poster.jpg');
  });

  it('uses the text title when there is no logo at all', async () => {
    const presentation = await prepareFilmPresentation(film(), { pipeline: pipeline() });

    expect(presentation.titleMode).toBe('text');
    expect(presentation.titleReason).toBe('no-candidate');
    expect(presentation.logoUrl).toBe('');
  });

  it('commits to a light logo unchanged', async () => {
    const presentation = await prepareFilmPresentation(
      film({ logoCandidates: [logoCandidate()] }),
      {
        pipeline: pipeline(),
        canvasFactory: canvasOf([250, 250, 250, 255]),
      },
    );

    expect(presentation.titleMode).toBe('logo');
    expect(presentation.logoTone).toBe('light');
    expect(presentation.logoFilter).toBe('none');
  });

  it('lightens a black logo instead of showing it unreadable', async () => {
    const presentation = await prepareFilmPresentation(
      film({ logoCandidates: [logoCandidate()] }),
      {
        pipeline: pipeline(),
        canvasFactory: canvasOf([8, 8, 8, 255]),
      },
    );

    expect(presentation.titleMode).toBe('logo');
    expect(presentation.logoTone).toBe('dark-monochrome');
    expect(presentation.logoFilter).toContain('invert');
  });

  it('falls back to text when the canvas cannot be read (CORS)', async () => {
    const presentation = await prepareFilmPresentation(
      film({ logoCandidates: [logoCandidate()] }),
      {
        pipeline: pipeline(),
        canvasFactory: () => null,
      },
    );

    expect(presentation.titleMode).toBe('text');
  });

  it('falls back to text when the logo misses the preflight budget', async () => {
    const slow: PresentationPipeline['load'] = () =>
      new Promise((resolve) => setTimeout(() => resolve(fakeImage), 400));

    const presentation = await prepareFilmPresentation(
      film({ logoCandidates: [logoCandidate()] }),
      {
        pipeline: pipeline(slow),
        canvasFactory: canvasOf([250, 250, 250, 255]),
        budgetMs: 60,
      },
    );

    expect(presentation.titleMode).toBe('text');
  });

  it('falls back to text when the logo fails to load', async () => {
    const failing: PresentationPipeline['load'] = () => Promise.reject(new Error('404'));

    const presentation = await prepareFilmPresentation(
      film({ logoCandidates: [logoCandidate()] }),
      {
        pipeline: pipeline(failing),
        canvasFactory: canvasOf([250, 250, 250, 255]),
      },
    );

    expect(presentation.titleMode).toBe('text');
  });

  it('is stable: two runs of the same film produce the same hero', async () => {
    const deps = { pipeline: pipeline(), canvasFactory: canvasOf([250, 250, 250, 255]) };
    const source = film({
      logoCandidates: [logoCandidate(), logoCandidate({ filePath: '/b.png' })],
    });

    const first = await prepareFilmPresentation(source, deps);
    const second = await prepareFilmPresentation(source, deps);

    expect(second.titleMode).toBe(first.titleMode);
    expect(second.logoUrl).toBe(first.logoUrl);
  });
});

describe('cached presentation', () => {
  beforeEach(async () => {
    await db.presentations.clear();
  });

  it('stores the decision', async () => {
    await prepareFilmPresentationCached(film({ logoCandidates: [logoCandidate()] }), {
      pipeline: pipeline(),
      canvasFactory: canvasOf([250, 250, 250, 255]),
    });

    expect((await db.presentations.get(1))?.mode).toBe('logo');
  });

  it('does not retry a logo that is unusable by nature', async () => {
    // First open: the artwork itself is unreadable → durable decision.
    const first = await prepareFilmPresentationCached(film({ logoCandidates: [logoCandidate()] }), {
      pipeline: pipeline(),
      canvasFactory: () => null,
    });
    expect(first.titleReason).toBe('unsafe');
    expect((await db.presentations.get(1))?.mode).toBe('text');

    // Second open: the logo is never fetched again.
    const load = vi.fn(() => Promise.resolve(fakeImage));
    const second = await prepareFilmPresentationCached(
      film({ logoCandidates: [logoCandidate()] }),
      {
        pipeline: pipeline(load),
        canvasFactory: canvasOf([250, 250, 250, 255]),
      },
    );

    expect(second.titleMode).toBe('text');
    expect(load).not.toHaveBeenCalled();
  });

  it('retries a logo that merely lost the budget last time', async () => {
    // A slow first open falls back to text — but not permanently.
    const first = await prepareFilmPresentationCached(film({ logoCandidates: [logoCandidate()] }), {
      pipeline: pipeline(() => new Promise((resolve) => setTimeout(() => resolve(fakeImage), 300))),
      canvasFactory: canvasOf([250, 250, 250, 255]),
      budgetMs: 30,
    });
    expect(first.titleReason).toBe('timeout');
    expect(await db.presentations.get(1)).toBeUndefined();

    // Warm cache on the next opening: the logo now wins.
    const second = await prepareFilmPresentationCached(
      film({ logoCandidates: [logoCandidate()] }),
      {
        pipeline: pipeline(),
        canvasFactory: canvasOf([250, 250, 250, 255]),
      },
    );

    expect(second.titleMode).toBe('logo');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavigationController } from '@app/navigation/NavigationController';
import { emptyFilm, summaryOf, type FilmSummary } from '@entities/film/film.model';

const load = vi.fn();
const prepare = vi.fn();

vi.mock('@entities/film/film.repository', () => ({
  filmRepository: { load: (...args: unknown[]) => load(...args) },
}));

vi.mock('./film.presentation', () => ({
  prepareFilmPresentationCached: (...args: unknown[]) => prepare(...args),
}));

const { openFilmWithPreflight, resetFilmOpenings, startFilmOpening, takeFilmOpening } = await import(
  './filmOpening'
);

const summary = (id = 7): FilmSummary => summaryOf({ ...emptyFilm(id, 'Фильм'), year: '2024' });

/** Resolves only when told to, so "started but not finished" is observable. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('film opening coordinator', () => {
  beforeEach(() => {
    resetFilmOpenings();
    load.mockReset();
    prepare.mockReset();
    load.mockResolvedValue({ film: emptyFilm(7, 'Фильм'), source: 'network' });
    prepare.mockResolvedValue({ filmId: 7, titleMode: 'text' });
  });

  it('starts the preflight before the route is pushed', async () => {
    const order: string[] = [];
    load.mockImplementation(async () => {
      order.push('preflight');
      return { film: emptyFilm(7, 'Фильм'), source: 'network' };
    });
    const navigation = {
      openFilm: () => order.push('push'),
    } as unknown as NavigationController;

    openFilmWithPreflight(navigation, summary());
    await vi.waitFor(() => expect(order).toContain('preflight'));

    // The push is not awaited — but the preflight must already be running by
    // the time the page mounts, which is what removes the blank hero.
    expect(order[0]).toBe('preflight');
    expect(order).toContain('push');
  });

  it('pushes the route without waiting for the preflight to finish', () => {
    const pending = deferred<{ film: ReturnType<typeof emptyFilm>; source: string }>();
    load.mockReturnValue(pending.promise);
    const openFilm = vi.fn();

    openFilmWithPreflight({ openFilm } as unknown as NavigationController, summary());

    // Still unresolved: a cold tap must never wait on the network (spec §28).
    expect(openFilm).toHaveBeenCalledWith({ filmId: 7, title: 'Фильм' });
    pending.resolve({ film: emptyFilm(7, 'Фильм'), source: 'cache' });
  });

  it('runs exactly one preflight per film and hands it to the page', async () => {
    const first = startFilmOpening(summary());
    const second = startFilmOpening(summary());

    expect(second).toBe(first);
    expect(takeFilmOpening(7)).toBe(first);

    await first;
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('has nothing to hand over for a film that was never opened', () => {
    expect(takeFilmOpening(999)).toBeNull();
  });

  it('never rejects when the film fails to load', async () => {
    load.mockRejectedValue(new Error('offline'));
    prepare.mockResolvedValue({ filmId: 7, titleMode: 'text' });

    // Both consumers use `void ... .then()`; a rejection here would be an
    // unhandled rejection and a hero that never paints.
    await expect(startFilmOpening(summary())).resolves.toMatchObject({ titleMode: 'text' });
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});

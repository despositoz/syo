import { describe, expect, it } from 'vitest';
import type { FilmLogoCandidate } from '@entities/film/film.model';
import { isUsableLogo, rankLogoCandidates, selectLogoCandidate } from './film.logo';

const logo = (overrides: Partial<FilmLogoCandidate>): FilmLogoCandidate => ({
  filePath: '/a.png',
  language: 'en',
  width: 800,
  height: 260,
  aspectRatio: 3.07,
  voteAverage: 5,
  voteCount: 4,
  ...overrides,
});

describe('logo usability filter', () => {
  it('rejects tiny, square and absurdly wide artwork', () => {
    expect(isUsableLogo(logo({ width: 90 }))).toBe(false);
    expect(isUsableLogo(logo({ height: 20 }))).toBe(false);
    expect(isUsableLogo(logo({ aspectRatio: 1 }))).toBe(false);
    expect(isUsableLogo(logo({ aspectRatio: 12 }))).toBe(false);
    expect(isUsableLogo(logo({ filePath: '' }))).toBe(false);
    expect(isUsableLogo(logo({}))).toBe(true);
  });
});

describe('logo selection', () => {
  it('prefers the UI language, then English, then language-neutral art', () => {
    const ranked = rankLogoCandidates([
      logo({ filePath: '/fr.png', language: 'fr' }),
      logo({ filePath: '/neutral.png', language: null }),
      logo({ filePath: '/en.png', language: 'en' }),
      logo({ filePath: '/ru.png', language: 'ru' }),
    ]);

    expect(ranked.map((item) => item.filePath)).toEqual([
      '/ru.png',
      '/en.png',
      '/neutral.png',
      '/fr.png',
    ]);
  });

  it('prefers higher-rated artwork inside the same language', () => {
    const best = selectLogoCandidate([
      logo({ filePath: '/weak.png', language: 'ru', voteAverage: 1, voteCount: 1 }),
      logo({ filePath: '/strong.png', language: 'ru', voteAverage: 8, voteCount: 40 }),
    ]);

    expect(best?.filePath).toBe('/strong.png');
  });

  it('prefers a wide lockup when quality is comparable', () => {
    const best = selectLogoCandidate([
      logo({ filePath: '/tall.png', language: 'ru', aspectRatio: 1.4 }),
      logo({ filePath: '/wide.png', language: 'ru', aspectRatio: 3.0 }),
    ]);

    expect(best?.filePath).toBe('/wide.png');
  });

  it('is deterministic — the same input always yields the same hero', () => {
    const candidates = [
      logo({ filePath: '/b.png', language: 'ru' }),
      logo({ filePath: '/a.png', language: 'ru' }),
    ];

    const first = selectLogoCandidate(candidates)?.filePath;
    const second = selectLogoCandidate([...candidates].reverse())?.filePath;
    expect(first).toBe(second);
  });

  it('returns null when nothing is usable', () => {
    expect(selectLogoCandidate([])).toBeNull();
    expect(selectLogoCandidate([logo({ width: 40, height: 12, aspectRatio: 3.3 })])).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { pathToStack, routeToPath } from './routes';

/**
 * BASE_URL is '/' under Vitest, so these cover the domain-root case.
 * The subdirectory case (GitHub Pages, BASE_URL='/syo/') is covered by the
 * round-trip property below: whatever routeToPath writes, pathToStack reads
 * back — that is the invariant that keeps a subpath deployment inside the app.
 */
describe('routes', () => {
  it('maps root tabs', () => {
    expect(routeToPath({ kind: 'root', tab: 'feed' })).toBe('/');
    expect(routeToPath({ kind: 'root', tab: 'diary' })).toBe('/diary');
  });

  it('maps the picker and a film', () => {
    expect(routeToPath({ kind: 'picker' })).toBe('/rate');
    expect(routeToPath({ kind: 'film', filmId: 693134 })).toBe('/film/693134');
  });

  it('reads a film path back into a stack that can be closed', () => {
    expect(pathToStack('/film/693134')).toEqual([
      { kind: 'root', tab: 'feed' },
      { kind: 'film', filmId: 693134 },
    ]);
  });

  it('falls back to the feed on anything unknown', () => {
    expect(pathToStack('/nonsense')).toEqual([{ kind: 'root', tab: 'feed' }]);
    expect(pathToStack('/film/not-a-number')).toEqual([{ kind: 'root', tab: 'feed' }]);
    expect(pathToStack('/')).toEqual([{ kind: 'root', tab: 'feed' }]);
  });

  it('round-trips every route through its own path', () => {
    const routes = [
      { kind: 'root', tab: 'feed' },
      { kind: 'root', tab: 'diary' },
      { kind: 'root', tab: 'profile' },
      { kind: 'picker' },
      { kind: 'film', filmId: 42 },
    ] as const;

    for (const route of routes) {
      const stack = pathToStack(routeToPath(route));
      expect(stack[stack.length - 1]).toMatchObject(route);
    }
  });
});

describe('profile routes', () => {
  it('opens the taste signature from its own URL', () => {
    // 'profile' is a tab *and* a prefix: the longer form has to win.
    const stack = pathToStack('/profile/signature');
    expect(stack.map((route) => route.kind)).toEqual(['root', 'tasteSignature']);
  });

  it('keeps the bare profile tab working', () => {
    expect(pathToStack('/profile')).toEqual([{ kind: 'root', tab: 'profile' }]);
  });

  it('round-trips settings sections', () => {
    for (const section of ['root', 'appearance', 'data', 'about'] as const) {
      const path = routeToPath({ kind: 'settings', section });
      const stack = pathToStack(path);
      expect(stack[stack.length - 1]).toEqual({ kind: 'settings', section });
    }
  });
});

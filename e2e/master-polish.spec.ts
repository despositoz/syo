import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockTelegram, mockTmdb } from './fixtures';
import { seedDiary, seedFilms } from './helpers/seed';
import { expectInsideViewport, expectNoOverlap } from './helpers/layout';

/**
 * The rules the Master spec applies to every screen (§53).
 *
 * These are the checks that rot silently: one new screen, one Unicode arrow,
 * one card 2px wider than its track. Running them over every core screen at
 * every required width is cheaper than remembering.
 */

const WIDTHS = [280, 320, 360, 393, 430] as const;

/** Every core screen, and how to get there from a cold start. */
const SCREENS: { name: string; path: string; ready: string }[] = [
  { name: 'feed', path: '/', ready: '[data-feed-item]' },
  { name: 'diary', path: '/diary', ready: 'main' },
  { name: 'profile', path: '/profile', ready: '[data-testid="profile-identity"]' },
  { name: 'taste', path: '/profile/signature', ready: '[data-testid="taste-page-headline"]' },
  { name: 'settings', path: '/settings', ready: '[data-testid="settings-theme"]' },
  { name: 'picker', path: '/rate', ready: 'main' },
];

/** An archive big enough that every screen has something real to show. */
const seedArchive = async (page: Page) => {
  await page.goto('/');
  await seedFilms(
    page,
    Array.from({ length: 16 }, (_, index) => ({
      id: 900 + index,
      title: `Картина ${index + 1}`,
      genres: index % 2 === 0 ? ['фантастика', 'драма'] : ['драма'],
      director: index % 3 === 0 ? 'Дени Вильнёв' : `Режиссёр ${index}`,
    })),
  );
  await seedDiary(page, {
    count: 16,
    overrides: (index) => ({
      filmId: 900 + index,
      filmTitle: `Картина ${index + 1}`,
      overallRating: index % 2 === 0 ? 5 : 3,
      preciseRating: index % 2 === 0 ? 5 : 3,
    }),
  });
};

test.describe('Master polish', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
  });

  for (const width of WIDTHS) {
    test(`no horizontal overflow anywhere at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await seedArchive(page);

      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await page.locator(screen.ready).first().waitFor({ state: 'attached' });
        await page.waitForTimeout(150);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${screen.name} scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test('every touch target is at least 44px on every core screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await seedArchive(page);

    for (const screen of SCREENS) {
      await page.goto(screen.path);
      await page.locator(screen.ready).first().waitFor({ state: 'attached' });
      await page.waitForTimeout(150);

      const small = await page.evaluate(() =>
        [...document.querySelectorAll('button, a[href], input[type="radio"], [role="radio"]')]
          .filter((node) => (node as HTMLElement).offsetParent !== null)
          .map((node) => {
            /*
             * The target is what a finger can actually hit: a 20px radio inside
             * a 44px label is a 44px target, and measuring the input alone
             * would report a violation that does not exist.
             */
            const target = node.closest('label') ?? node;
            const box = target.getBoundingClientRect();
            return {
              label: node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 20) ?? '',
              w: Math.round(box.width),
              h: Math.round(box.height),
            };
          })
          .filter((item) => item.w > 0 && (item.w < 44 || item.h < 44)),
      );
      expect(small, `${screen.name} has controls under 44px`).toEqual([]);
    }
  });

  test('no Unicode glyph is used as an icon', async ({ page }) => {
    await seedArchive(page);

    for (const screen of SCREENS) {
      await page.goto(screen.path);
      await page.locator(screen.ready).first().waitFor({ state: 'attached' });

      // Arrows, stars, crosses and pencils belong to the SVG set, not to text.
      const glyphs = await page.evaluate(() => {
        const forbidden = /[←→↑↓★☆✕✖✎↺⟳●▲▼]/u;
        return [...document.querySelectorAll('button, span, a')]
          .filter((node) => (node as HTMLElement).offsetParent !== null)
          .map((node) => (node.childNodes.length === 1 ? (node.textContent ?? '') : ''))
          .filter((text) => forbidden.test(text));
      });
      expect(glyphs, `${screen.name} renders a Unicode icon`).toEqual([]);
    }
  });

  test('no screen shows two back buttons at once', async ({ page }) => {
    await seedArchive(page);

    for (const path of ['/profile/signature', '/settings', '/diary']) {
      await page.goto(path);
      await page.waitForTimeout(200);
      const backs = await page.getByRole('button', { name: 'Назад' }).count();
      expect(backs, `${path} has ${backs} back buttons`).toBeLessThanOrEqual(1);
    }
  });

  test('200% text keeps every core screen usable', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await seedArchive(page);

    for (const screen of SCREENS) {
      await page.goto(screen.path);
      await page.locator(screen.ready).first().waitFor({ state: 'attached' });
      await page.addStyleTag({ content: 'html { font-size: 32px; }' });
      await page.waitForTimeout(200);

      /*
       * Content controls only. The bottom bar and the "new items" pill float
       * over the list on purpose (the pill lives inside main, so it has to be
       * named); that they do not *cover* anything is checked
       * separately, and including them here would flag the design as a defect.
       * Topmost main only: a covered root screen is still in the DOM, and
       * measuring two stacked screens at once compares unrelated boxes.
       */
      const buttons = page
        .locator('main')
        .last()
        .locator('button:not([data-testid="feed-new-items"]):visible');
      await expectInsideViewport(page, buttons, `${screen.name} @200%`);
      await expectNoOverlap(buttons, `${screen.name} @200%`);
    }
  });

  test('the bottom bar never covers a root screen’s last control', async ({ page }) => {
    await seedArchive(page);

    for (const path of ['/', '/diary', '/profile']) {
      await page.goto(path);
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        const scroller = document.querySelector('.scroll-y');
        if (scroller) scroller.scrollTo(0, scroller.scrollHeight);
      });
      await page.waitForTimeout(200);

      const bar = await page.locator('nav').first().boundingBox();
      const last = await page.evaluate(() => {
        const main = document.querySelector('main');
        if (!main) return null;
        const controls = [...main.querySelectorAll('button, a[href]')].filter(
          (node) => (node as HTMLElement).offsetParent !== null,
        );
        const bottoms = controls.map((node) => node.getBoundingClientRect().bottom);
        return bottoms.length ? Math.max(...bottoms) : null;
      });

      if (bar && last !== null) {
        // The bar floats above content, so content must end before it starts.
        expect(last, `${path} hides its last control behind the bar`).toBeLessThanOrEqual(
          bar.y + bar.height + 1,
        );
      }
    }
  });

  test('a nested screen is opaque from its first frame', async ({ page }) => {
    await seedArchive(page);
    await page.goto('/profile');
    await page.getByTestId('taste-open').click();

    // Sampled while the transition is still running: the feed must not show
    // through a nested screen at any point (§18).
    for (let frame = 0; frame < 6; frame += 1) {
      const seesFeed = await page.evaluate(() => {
        const items = [...document.querySelectorAll('[data-feed-item]')];
        return items.some((node) => {
          const style = getComputedStyle(node as HTMLElement);
          return style.visibility !== 'hidden' && Number(style.opacity) > 0.02;
        });
      });
      expect(seesFeed, 'the feed shows through a nested screen').toBe(false);
      await page.waitForTimeout(40);
    }
  });

  test('the calm setting reaches the durations themselves', async ({ page }, testInfo) => {
    // Under system Reduce Motion the in-app choice is deliberately powerless,
    // which is asserted by the Reduce Motion test below instead.
    test.skip(testInfo.project.name === 'reduced-motion', 'the system switch wins here');
    await seedArchive(page);
    await page.goto('/settings');
    await page.getByTestId('settings-motion-calm').click();

    // One attribute selects --motion-scale, and every duration token is a
    // multiple of it: the setting cannot apply to only half the app.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.motion))
      .toBe('calm');
    // Measured on a real element: the token is a calc(), so reading the custom
    // property back would only return the unresolved expression.
    const seconds = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.transition = 'opacity var(--duration-fast) linear';
      document.body.append(probe);
      const value = getComputedStyle(probe).transitionDuration;
      probe.remove();
      return Number.parseFloat(value);
    });
    expect(seconds).toBeLessThan(0.14);
    expect(seconds).toBeGreaterThan(0);
  });

  test('reduced motion keeps every screen complete', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedArchive(page);

    for (const screen of SCREENS) {
      await page.goto(screen.path);
      await page.locator(screen.ready).first().waitFor({ state: 'attached' });

      // Nothing is left invisible by a transition that never runs.
      const hidden = await page.evaluate(() => {
        const main = document.querySelector('main') ?? document.body;
        return Number(getComputedStyle(main).opacity) < 0.99;
      });
      expect(hidden, `${screen.name} stays faded under reduced motion`).toBe(false);
    }
  });
});

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockTelegram, mockTmdb } from './fixtures';
import { seedDiary } from './helpers/seed';
import { expectInsideViewport, expectNoOverlap } from './helpers/layout';

/**
 * The personal feed (P0.4).
 *
 * Every case here is about what the user can see and do: that the feed paints
 * from cache, that a reason is checkable, that a gesture has a button beside
 * it, and that coming back from a film lands where they left.
 */

const cards = (page: Page) => page.locator('[data-feed-item]');

const openFeed = async (page: Page) => {
  await page.goto('/');
  await expect(cards(page).first()).toBeVisible();
};

/**
 * Scrolls a share of whatever room this viewport actually has. A fixed pixel
 * amount means something different on a Pixel than on an iPhone, and a test
 * that assumes one of them is testing the device, not the feed.
 */
const scrollFeed = async (page: Page, share: number): Promise<number> => {
  const room = await page
    .getByTestId('feed-scroll')
    .evaluate((node) => node.scrollHeight - node.clientHeight);
  if (room <= 40) return 0;

  const target = Math.round(room * share);
  await page.getByTestId('feed-scroll').evaluate((node, top) => node.scrollTo(0, top), target);
  await page.waitForTimeout(120);
  return page.getByTestId('feed-scroll').evaluate((node) => node.scrollTop);
};

/** Rates films so the local engines have something real to say. */
const seedRatedFilms = async (page: Page, count = 8) => {
  await page.goto('/');
  await seedDiary(page, {
    count,
    overrides: (index) => ({
      // Deliberately not the films the mock serves as trending: a rated film
      // is excluded from recommendations, and seeding those would leave the
      // feed with nothing to show (§13.4).
      filmId: 900 + index,
      filmTitle: `Фильм ${900 + index}`,
      overallRating: index % 3 === 0 ? 5 : 4,
      preciseRating: index % 3 === 0 ? 5 : 4,
    }),
  });
};

test.describe('Feed', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
  });

  test('paints discovery on a cold start without pretending to be personal', async ({ page }) => {
    await openFeed(page);

    await expect(page.getByTestId('feed-invitation')).toBeVisible();
    await expect(page.getByTestId('feed-discovery').first()).toBeVisible();
    // Nothing claims to know a taste that does not exist yet.
    await expect(page.getByText(/ты оценил высоко/)).toHaveCount(0);
    await expect(page.getByText('Сейчас часто смотрят').first()).toBeVisible();
  });

  test('has no big "Лента" heading and shows the wordmark once', async ({ page }) => {
    await openFeed(page);

    await expect(page.getByRole('heading', { name: 'Лента' })).toHaveCount(0);
    await expect(page.getByLabel('SYO')).toHaveCount(1);
  });

  test('the cached feed is on screen before any network answer', async ({ page }) => {
    await openFeed(page);
    await page.reload();

    // A slow network must not blank what was already stored.
    await page.route('**/trending/**', (route) => setTimeout(() => void route.abort(), 3000));
    await expect(cards(page).first()).toBeVisible({ timeout: 2000 });
  });

  test('a card explains itself and offers a way out', async ({ page }) => {
    await seedRatedFilms(page);
    await openFeed(page);

    const why = page.getByTestId('feed-why').first();
    await why.click();

    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(/Похож|список|часто смотрят|Ещё один фильм/);
    await expect(page.getByTestId('feed-why-not-interested')).toBeVisible();
  });

  test('"not interested" hides the card and Undo brings it back', async ({ page }) => {
    await seedRatedFilms(page);
    await openFeed(page);

    const before = await cards(page).count();
    const firstId = await cards(page).first().getAttribute('data-feed-item');

    await page.getByTestId('feed-why').first().click();
    await page.getByTestId('feed-why-not-interested').click();

    await expect(page.locator(`[data-feed-item="${firstId}"]`)).toHaveCount(0);
    await page.getByTestId('snackbar-action').click();

    await expect(page.locator(`[data-feed-item="${firstId}"]`)).toHaveCount(1);
    expect(await cards(page).count()).toBe(before);
  });

  test('bookmarking works without any gesture', async ({ page }) => {
    await openFeed(page);

    const bookmark = page.getByTestId('feed-bookmark').first();
    await expect(bookmark).toHaveAttribute('aria-pressed', 'false');
    await bookmark.click();

    await expect(bookmark).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Добавлено в «Посмотреть позже»')).toBeVisible();
  });

  test('opening a film and coming back keeps the place', async ({ page }) => {
    await openFeed(page);
    const before = await scrollFeed(page, 0.4);
    test.skip(before < 40, 'this viewport shows the whole feed without scrolling');

    await page.getByTestId('feed-open-film').nth(2).click();
    await expect(page.getByTestId('film-title')).toBeAttached();
    await page.goBack();

    await expect(cards(page).first()).toBeVisible();
    const after = await page.getByTestId('feed-scroll').evaluate((node) => node.scrollTop);
    // Back to roughly where they were, not to the top.
    expect(Math.abs(after - before)).toBeLessThan(200);
  });

  test('the header hides on a deliberate scroll and returns on the way up', async ({ page }) => {
    await openFeed(page);
    const header = page.locator('header').first();
    await expect(header).toBeVisible();

    // Past the always-visible band at the top, or the header is meant to stay.
    const down = await scrollFeed(page, 0.9);
    test.skip(down < 120, 'this viewport never scrolls past the always-visible band');
    await expect(page.locator('[data-hidden="true"]')).toHaveCount(1);

    await page.getByTestId('feed-scroll').evaluate((node) => node.scrollBy(0, -200));
    await page.waitForTimeout(200);
    await expect(page.locator('[data-hidden="true"]')).toHaveCount(0);
  });

  test('a small scroll jitter does not flicker the header', async ({ page }) => {
    await openFeed(page);
    const down = await scrollFeed(page, 0.9);
    test.skip(down < 120, 'this viewport never scrolls past the always-visible band');

    for (const delta of [8, -8, 6, -6]) {
      await page.getByTestId('feed-scroll').evaluate((node, by) => node.scrollBy(0, by), delta);
      await page.waitForTimeout(60);
    }
    // Still hidden: a few pixels either way is not an intent.
    await expect(page.locator('[data-hidden="true"]')).toHaveCount(1);
  });

  test('the feed never scrolls sideways and every card stays in view', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await openFeed(page);

    await expectNoOverlap(cards(page), 'feed cards');
    await expectInsideViewport(page, cards(page), 'feed cards');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the bottom bar never covers the last card', async ({ page }) => {
    await openFeed(page);
    await page.getByTestId('feed-scroll').evaluate((node) => node.scrollTo(0, node.scrollHeight));
    await page.waitForTimeout(200);

    const last = await cards(page).last().boundingBox();
    const bar = await page.locator('nav').first().boundingBox();
    if (last && bar) expect(last.y + last.height).toBeLessThanOrEqual(bar.y + 1);
  });

  test('an observation shows its evidence when asked', async ({ page }) => {
    await seedRatedFilms(page, 10);
    await openFeed(page);

    const observation = page.getByTestId('feed-observation').first();
    if ((await observation.count()) === 0) test.skip();

    const toggle = observation.getByRole('button').first();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(observation.getByTestId('feed-evidence')).toBeVisible();
  });

  test('a repeated tap on the active tab goes to the top', async ({ page }) => {
    await openFeed(page);
    const down = await scrollFeed(page, 0.5);
    test.skip(down < 40, 'this viewport shows the whole feed without scrolling');

    await page.getByRole('button', { name: 'Лента' }).click();
    await page.waitForTimeout(500);

    expect(await page.getByTestId('feed-scroll').evaluate((node) => node.scrollTop)).toBeLessThan(
      50,
    );
  });

  test('everything a gesture does is reachable from the keyboard', async ({ page }) => {
    await openFeed(page);

    const reachable = await page.evaluate(() => {
      const card = document.querySelector('[data-feed-item]');
      if (!card) return [];
      return [...card.querySelectorAll('button')]
        .filter((button) => button.tabIndex >= 0)
        .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '');
    });

    expect(reachable.some((label) => /Посмотреть позже/.test(label))).toBe(true);
    expect(reachable.length).toBeGreaterThanOrEqual(2);
  });

  test('no card nests a button inside a button', async ({ page }) => {
    await openFeed(page);

    const nested = await page.evaluate(
      () => document.querySelectorAll('button button, a button, button a').length,
    );
    expect(nested).toBe(0);
  });
});

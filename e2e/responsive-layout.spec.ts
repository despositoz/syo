import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockTelegram, mockTmdb } from './fixtures';
import { diaryText, seedDiary } from './helpers/seed';
import {
  expectInsideViewport,
  expectNoIntersection,
  expectNoOverlap,
  expectPosterFillsFrame,
} from './helpers/layout';

/**
 * Responsive layout (P0.3.1 §12).
 *
 * Every assertion here is a measurement of a real box. The suite exists
 * because the old overflow check — `documentElement.scrollWidth` — passes
 * happily while cards sit on top of each other.
 */

/** The narrow end is defensive: 280 px is not a phone, it is a broken window. */
const NARROW = [280, 320, 360, 393, 430] as const;

const openDiary = async (page: Page, options: Parameters<typeof seedDiary>[1] = {}) => {
  await page.goto('/');
  await seedDiary(page, options);
  await page.goto('/diary');
  await expect(page.getByRole('heading', { name: 'Дневник' })).toBeVisible();
  await expect(page.locator('[data-testid^="diary-card-"]').first()).toBeVisible();
};

const cards = (page: Page) => page.locator('[data-testid^="diary-card-"]');
const posters = (page: Page) => page.locator('[data-poster-root]');

test.describe('Diary grid', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page);
    await mockTelegram(page, { fullscreen: true });
  });

  for (const width of NARROW) {
    test(`six cards never overlap at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await openDiary(page);

      await expectNoOverlap(cards(page), `diary cards @${width}`);
      await expectNoOverlap(posters(page), `diary posters @${width}`);
      await expectInsideViewport(page, cards(page), `diary cards @${width}`);
      await expectInsideViewport(page, posters(page), `diary posters @${width}`);
    });

    test(`the poster fills its frame at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await openDiary(page);

      await expectPosterFillsFrame(page, '[data-poster-frame]', `diary grid @${width}`);
    });
  }

  test('the list view keeps its 56px poster unclipped', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await openDiary(page);

    await page.getByTestId('view-list').click();
    await expectPosterFillsFrame(page, '[data-poster-frame]', 'diary list');
    await expectNoOverlap(cards(page), 'diary list cards');
  });

  test('switching grid and list keeps every poster inside its frame', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await openDiary(page);

    await page.getByTestId('view-list').click();
    await expectPosterFillsFrame(page, '[data-poster-frame]', 'after switching to list');
    await page.getByTestId('view-grid').click();
    await expectPosterFillsFrame(page, '[data-poster-frame]', 'back in the grid');
    await expectNoOverlap(cards(page), 'back in the grid');
  });

  test('a long title does not push the card out of its track', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await openDiary(page, {
      overrides: () => ({
        filmTitle: 'Невыносимо длинное название фильма, которое не помещается никуда',
      }),
    });

    await expectNoOverlap(cards(page), 'long titles');
    await expectInsideViewport(page, cards(page), 'long titles');
  });

  test('an unbroken word in the text does not run out of the card', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await openDiary(page, {
      overrides: () => ({
        hasText: true,
        text: diaryText('bhboujojiojnv8gy9uhoijnihbuyg8h7g6f5d4s3a2q1wertyuiopasdfghjkl'),
      }),
    });
    await page.getByTestId('view-list').click();

    // Every child stays inside the card that owns it — line-clamp alone does
    // not stop a keysmash from running off the screen.
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="diary-card-"]')].map((card) => {
        const box = card.getBoundingClientRect();
        const widest = Math.max(
          ...[...card.querySelectorAll('*')].map((child) => child.getBoundingClientRect().right),
        );
        return widest - box.right;
      }),
    );
    overflow.forEach((amount, index) => {
      expect(amount, `card #${index} spills ${amount}px past its own edge`).toBeLessThanOrEqual(1);
    });
  });

  test('a missing poster falls back inside the same frame', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await openDiary(page, { overrides: () => ({ posterPath: null }) });

    await expectPosterFillsFrame(page, '[data-poster-frame]', 'typographic fallback');
  });

  test('the excerpt stays out of the grid and shows in the list', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await openDiary(page, {
      overrides: () => ({ hasText: true, text: diaryText('Текст о фильме, который я написал') }),
    });

    // The grid is about recognising the poster, not reading (§6.4).
    await expect(page.getByTestId('card-excerpt')).toHaveCount(0);
    await expect(page.getByTestId('card-text-marker').first()).toBeVisible();

    await page.getByTestId('view-list').click();
    await expect(page.getByTestId('card-excerpt').first()).toBeVisible();
  });

  test('a deep precise score is readable, not a 4px dot', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await openDiary(page, {
      count: 1,
      overrides: () => ({
        mode: 'deep',
        overallRating: 5,
        preciseRating: 4.6,
        aspects: { story: 5, characters: 5, direction: 4, sound: 4, aftertaste: 5 },
      }),
    });

    const precise = page.getByTestId('card-precise').first();
    await expect(precise).toHaveText('4,6');
    const box = (await precise.boundingBox())!;
    // A number cannot live in a dot: it needs room for its own glyphs.
    expect(box.width).toBeGreaterThan(14);
    expect(box.height).toBeGreaterThan(10);
    // The number sits beside the stars, never on top of them.
    await expectNoIntersection(
      precise,
      page.locator('[data-testid^="diary-card-"] svg').first(),
      'precise vs stars',
    );
  });
});

test.describe('Active draft card', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
  });

  test('the draft poster is not clipped at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/');
    await page.getByText('Фильм 101').click();
    await page
      .getByRole('button', { name: /Начать оценку|Продолжить оценку|Изменить оценку/ })
      .click();
    await page.getByTestId('mode-quick').click();
    await page.getByRole('radio').nth(2).click();

    await page.goto('/diary');
    await expect(page.getByTestId('active-draft-card')).toBeVisible();

    await expectPosterFillsFrame(page, '[data-poster-frame]', 'active draft');
    await expectInsideViewport(page, page.getByTestId('active-draft-card'), 'active draft');
  });
});

test.describe('Rating and writing at 320px', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
    await page.setViewportSize({ width: 320, height: 700 });
  });

  const openRating = async (page: Page) => {
    await page.goto('/');
    await page.getByText('Фильм 101').click();
    await page
      .getByRole('button', { name: /Начать оценку|Продолжить оценку|Изменить оценку/ })
      .click();
  };

  test('the rating hero poster is not clipped', async ({ page }) => {
    await openRating(page);
    await page.getByTestId('mode-quick').click();

    await expectPosterFillsFrame(page, '[data-poster-frame]', 'rating hero');
    await expectInsideViewport(page, page.locator('[data-poster-root]'), 'rating hero');
  });

  test('the result hero poster is not clipped', async ({ page }) => {
    await openRating(page);
    await page.getByTestId('mode-quick').click();
    await page.getByRole('radio').nth(3).click();
    await page.getByTestId('quick-continue').click();

    await expectPosterFillsFrame(page, '[data-poster-frame]', 'result hero');
  });

  test('the three AI operations fit the width', async ({ page }) => {
    await openRating(page);
    await page.getByTestId('mode-quick').click();
    await page.getByRole('radio').nth(3).click();
    await page.getByTestId('quick-continue').click();
    await page.getByTestId('result-save-and-write').click();
    await page.getByTestId('writing-mode-free').click();
    await page.getByTestId('writing-textarea').fill('Текст');

    const buttons = page.locator('[data-testid^="writing-op-"]');
    await expect(buttons).toHaveCount(3);
    await expectInsideViewport(page, buttons, 'AI operations @320');
    await expectNoOverlap(buttons, 'AI operations @320');

    // Every one of them is a real touch target.
    for (const box of await buttons.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height),
    )) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
    await expectLabelsFit(page);
  });

  /** Each label fits inside its own button — no clipping, no shrunken font. */
  const expectLabelsFit = async (page: Page) => {
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="writing-op-"]')].map((button) => {
        const box = button.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(button);
        return range.getBoundingClientRect().width - box.width;
      }),
    );
    overflow.forEach((amount, index) => {
      expect(amount, `label #${index} spills ${amount}px out of its button`).toBeLessThanOrEqual(
        0.5,
      );
    });
  };

  test('the AI operations survive 150% text', async ({ page }) => {
    await openRating(page);
    await page.getByTestId('mode-quick').click();
    await page.getByRole('radio').nth(3).click();
    await page.getByTestId('quick-continue').click();
    await page.getByTestId('result-save-and-write').click();
    await page.getByTestId('writing-mode-free').click();

    await page.addStyleTag({ content: 'html { font-size: 24px; }' });
    await page.getByTestId('writing-textarea').fill('Текст');

    const buttons = page.locator('[data-testid^="writing-op-"]');
    await expectInsideViewport(page, buttons, 'AI operations @150% text');
    await expectNoOverlap(buttons, 'AI operations @150% text');
    await expectLabelsFit(page);
  });

  test('the AI operations survive 200% text', async ({ page }) => {
    await openRating(page);
    await page.getByTestId('mode-quick').click();
    await page.getByRole('radio').nth(3).click();
    await page.getByTestId('quick-continue').click();
    await page.getByTestId('result-save-and-write').click();
    await page.getByTestId('writing-mode-free').click();

    await page.addStyleTag({ content: 'html { font-size: 32px; }' });
    await page.getByTestId('writing-textarea').fill('Текст');

    const buttons = page.locator('[data-testid^="writing-op-"]');
    await expectInsideViewport(page, buttons, 'AI operations @200% text');
    await expectNoOverlap(buttons, 'AI operations @200% text');
    await expectLabelsFit(page);

    // Still a real touch target after the row has rearranged itself.
    for (const height of await buttons.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height),
    )) {
      expect(height).toBeGreaterThanOrEqual(44);
    }
  });

  test('the snackbar never covers the writing CTA', async ({ page }) => {
    await openRating(page);
    await page.getByTestId('mode-quick').click();
    await page.getByRole('radio').nth(3).click();
    await page.getByTestId('quick-continue').click();
    await page.getByTestId('result-save-and-write').click();
    await page.getByTestId('writing-mode-free').click();
    await page.getByTestId('writing-textarea').fill('Текст');

    const snackbar = page.getByRole('status');
    if (await snackbar.isVisible().catch(() => false)) {
      await expectNoIntersection(
        snackbar,
        page.getByTestId('writing-to-preview'),
        'snackbar / CTA',
      );
      await expectNoIntersection(
        snackbar,
        page.locator('[data-testid^="writing-op-"]').first(),
        'snackbar / AI operations',
      );
    }
  });
});

test.describe('Dialogs and controls', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
  });

  test('a sheet keeps the keyboard inside it', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.getByText('Фильм 101').click();
    await page
      .getByRole('button', { name: /Начать оценку|Продолжить оценку|Изменить оценку/ })
      .click();
    await page.getByTestId('mode-quick').click();
    await page.getByRole('radio').nth(3).click();
    await page.getByTestId('quick-continue').click();
    await page.getByTestId('result-save-and-write').click();
    await page.getByTestId('writing-mode-free').click();
    await page.getByTestId('writing-textarea').fill('Текст');
    await page.getByTestId('writing-exit').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const open = document.querySelector('[role="dialog"]');
        return Boolean(open && document.activeElement && open.contains(document.activeElement));
      });
      expect(inside, `Tab #${step + 1} left the dialog`).toBe(true);
    }
  });

  test('the diary view toggle keeps a full touch target', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await openDiary(page);

    for (const id of ['view-grid', 'view-list']) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.height, `${id} is too short to hit`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${id} is too narrow to hit`).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('Desktop windows', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page);
    await mockTelegram(page, { fullscreen: false });
  });

  test('a narrow desktop window uses the same safe geometry', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await openDiary(page);

    await expectNoOverlap(cards(page), 'narrow desktop');
    await expectInsideViewport(page, cards(page), 'narrow desktop');
  });

  test('a wide window does not stretch one card across the screen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDiary(page);

    const card = (await cards(page).first().boundingBox())!;
    // A personal diary is not a billboard (§6.3).
    expect(card.width).toBeLessThan(320);

    const content = (await page.locator('main').first().boundingBox())!;
    expect(content.width).toBeLessThanOrEqual(800);
  });
});

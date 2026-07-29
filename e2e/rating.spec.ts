import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  cssVar,
  isTelegramBackVisible,
  mockTelegram,
  mockTmdb,
  pressTelegramBack,
} from './fixtures';

/** Film page → "Начать оценку" → mode chooser. */
const openModeChooser = async (page: Page) => {
  await page.goto('/');
  await page.getByText('Фильм 101').click();
  await expect(page.getByTestId('film-title')).toBeAttached();
  await page
    .getByRole('button', { name: /Начать оценку|Продолжить оценку|Изменить оценку/ })
    .click();
  await expect(page.getByTestId('mode-deep')).toBeVisible();
};

const stars = (page: Page) => page.getByRole('radio');

/** Taps the n-th star (1-5). */
const tapStar = async (page: Page, star: number) => {
  await stars(page)
    .nth(star - 1)
    .click();
};

/** Drags across the scale to the n-th star, proving the axis lock releases. */
const dragToStar = async (page: Page, star: number) => {
  const group = page.getByTestId('star-rating');
  const box = await group.boundingBox();
  const target = await stars(page)
    .nth(star - 1)
    .boundingBox();
  if (!box || !target) throw new Error('star control has no box');

  await page.mouse.move(box.x + 6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
};

const checkedStar = async (page: Page): Promise<number> => {
  const all = await stars(page).all();
  for (let index = 0; index < all.length; index += 1) {
    if ((await all[index]!.getAttribute('aria-checked')) === 'true') return index + 1;
  }
  return 0;
};

test.describe('Rating flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
  });

  test('the chooser offers both paths and creates no draft on its own', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeChooser(page);

    await expect(page.getByText('Как хочешь оценить фильм?')).toBeVisible();
    await expect(page.getByTestId('mode-deep')).toContainText('Разобрать впечатление');
    await expect(page.getByTestId('mode-quick')).toContainText('Быстро');

    // Merely looking at the chooser must not leave a draft behind.
    const draft = await page.evaluate(() => localStorage.getItem('syo:rating-draft:active'));
    expect(draft).toBeNull();
  });

  test('quick: nothing preselected, and the CTA waits for a choice', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeChooser(page);
    await page.getByTestId('mode-quick').click();

    await expect(page.getByRole('radiogroup')).toBeVisible();
    await expect(stars(page)).toHaveCount(5);
    // No default: not one star is checked, and there is no zero to fall into.
    expect(await checkedStar(page)).toBe(0);
    await expect(page.getByTestId('quick-continue')).toBeDisabled();

    await tapStar(page, 4);
    expect(await checkedStar(page)).toBe(4);
    await expect(page.getByText('Очень понравилось')).toBeVisible();
    await expect(page.getByTestId('quick-continue')).toBeEnabled();
  });

  test('dragging the stars commits the value under the finger', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeChooser(page);
    await page.getByTestId('mode-quick').click();

    await dragToStar(page, 5);
    expect(await checkedStar(page)).toBe(5);

    // Dragging back down works just as well.
    await dragToStar(page, 2);
    expect(await checkedStar(page)).toBe(2);
  });

  test('the stars leave vertical scrolling to the page', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeChooser(page);
    await page.getByTestId('mode-deep').click();

    /*
     * `pan-y` is what actually lets a finger scroll through the control; the
     * axis-lock decision itself is covered by the unit tests, because Playwright
     * can only drive a mouse here and a mouse drag legitimately *does* rate.
     */
    const touchAction = await page
      .getByTestId('star-rating')
      .evaluate((node) => getComputedStyle(node).touchAction);
    expect(touchAction).toBe('pan-y');
  });

  test('the whole flow is walkable from the keyboard alone', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeChooser(page);
    await page.getByTestId('mode-deep').click();

    for (let step = 0; step < 5; step += 1) {
      await expect(page.getByTestId('star-rating')).toBeVisible();
      await stars(page).nth(0).focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      expect(await checkedStar(page)).toBe(4);
      // Auto-advance carries the flow forward after a short settle.
      await page.waitForTimeout(600);
    }

    await expect(page.getByTestId('result-save')).toBeVisible();
  });

  test('five steps round to a whole star that cannot be edited by hand', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeChooser(page);
    await page.getByTestId('mode-deep').click();

    // 5, 4, 5, 4, 5 → 4.6 → 5 stars.
    for (const value of [5, 4, 5, 4, 5]) {
      await tapStar(page, value);
      await page.waitForTimeout(600);
    }

    await expect(page.getByTestId('result-save')).toBeVisible();
    await expect(page.getByText('4,6')).toBeVisible();
    // The total is computed: no interactive control on the result.
    await expect(page.getByTestId('star-rating')).toHaveCount(0);
  });

  test('a step cannot be skipped by tapping ahead', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeChooser(page);
    await page.getByTestId('mode-deep').click();

    await expect(page.getByTestId('step-marker-3')).toBeDisabled();
  });

  test('a draft survives a reload and resumes on the same step', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeChooser(page);
    await page.getByTestId('mode-deep').click();

    await tapStar(page, 4);
    await page.waitForTimeout(600);
    await tapStar(page, 3);
    await page.waitForTimeout(600);

    await expect(page.getByText('Как фильм был сделан?')).toBeVisible();

    await page.reload();

    // Same step, and the earlier answers are still in the running total.
    await expect(page.getByText('Как фильм был сделан?')).toBeVisible();
    await expect(page.getByText('Сейчас')).toBeVisible();
  });

  test('saving opens the saved entry and survives a restart', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeChooser(page);
    await page.getByTestId('mode-quick').click();

    await tapStar(page, 4);
    await page.getByTestId('quick-continue').click();
    await page.getByTestId('result-save').click();

    await expect(page.getByTestId('entry-menu')).toBeVisible();
    await expect(page.getByText('Фильм действительно тебе понравился')).toBeVisible();

    // Local-first: the entry is there after a restart, with no network involved.
    await page.reload();
    await expect(page.getByText('Фильм действительно тебе понравился')).toBeVisible();
  });

  test('the diary lists the saved film and opens it', async ({ page }) => {
    test.setTimeout(60_000);
    await mockTelegram(page, { fullscreen: true });
    await openModeChooser(page);
    await page.getByTestId('mode-quick').click();
    await tapStar(page, 5);
    await page.getByTestId('quick-continue').click();
    await page.getByTestId('result-save').click();
    await expect(page.getByTestId('entry-menu')).toBeVisible();

    await page.goto('/diary');
    await expect(page.getByRole('heading', { name: 'Дневник' })).toBeVisible();
    const card = page.locator('[data-testid^="diary-card-"]').first();
    await expect(card).toBeVisible();

    await card.click();
    await expect(page.getByTestId('entry-menu')).toBeVisible();
  });

  test('deleting an entry asks first and offers Undo', async ({ page }) => {
    test.setTimeout(60_000);
    await mockTelegram(page, { fullscreen: true });
    await openModeChooser(page);
    await page.getByTestId('mode-quick').click();
    await tapStar(page, 4);
    await page.getByTestId('quick-continue').click();
    await page.getByTestId('result-save').click();
    await expect(page.getByTestId('entry-menu')).toBeVisible();

    await page.getByTestId('entry-menu').click();
    await page.getByTestId('entry-delete').click();
    await expect(page.getByText('Запись исчезнет из Дневника.')).toBeVisible();
    await page.getByTestId('entry-delete-confirm').click();

    await expect(page.getByText('Оценка удалена')).toBeVisible();
    await page.getByTestId('snackbar-action').click();
    await expect(page.locator('[data-testid^="diary-card-"]').first()).toBeVisible();
  });

  test('an already rated film offers to edit instead of duplicating', async ({ page }) => {
    test.setTimeout(60_000);
    await mockTelegram(page, { fullscreen: true });
    await openModeChooser(page);
    await page.getByTestId('mode-quick').click();
    await tapStar(page, 3);
    await page.getByTestId('quick-continue').click();
    await page.getByTestId('result-save').click();
    await expect(page.getByTestId('entry-menu')).toBeVisible();

    await openModeChooser(page);
    await expect(page.getByText('Ты уже оценивал этот фильм')).toBeVisible();
    await expect(page.getByTestId('duplicate-edit')).toBeVisible();
  });

  test('the empty diary points at choosing a film', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await page.goto('/diary');

    await expect(page.getByText('Здесь будут фильмы, которые ты оценил')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Выбрать фильм' })).toBeVisible();
  });
});

test.describe('Rating flow inside Telegram', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
  });

  test('the bottom bar is hidden and the header clears the system chrome', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true, safeAreaTop: 59, safeAreaBottom: 34 });
    await openModeChooser(page);

    // A nested full-screen scenario: no root navigation underneath.
    await expect(page.getByRole('navigation')).toHaveCount(0);

    const back = await page.getByTestId('rating-back').boundingBox();
    const safeTop = Number.parseFloat(await cssVar(page, '--content-safe-top'));
    expect(back).not.toBeNull();
    expect(back!.y).toBeGreaterThanOrEqual(safeTop);
    expect(back!.height).toBeGreaterThanOrEqual(44);
  });

  test('non-fullscreen: Telegram owns back and we render none', async ({ page }) => {
    await mockTelegram(page, { fullscreen: false, fullscreenSupported: false });
    await openModeChooser(page);

    expect(await isTelegramBackVisible(page)).toBe(true);
    await expect(page.getByTestId('rating-back')).toHaveCount(0);
  });

  test('the Telegram back button steps back through the deep steps', async ({ page }) => {
    await mockTelegram(page, { fullscreen: false, fullscreenSupported: false });
    await openModeChooser(page);
    await page.getByTestId('mode-deep').click();

    await tapStar(page, 4);
    await page.waitForTimeout(600);
    await expect(page.getByText('Как тебе герои и актёрская игра?')).toBeVisible();

    await pressTelegramBack(page);
    await expect(page.getByText('Как сработала история?')).toBeVisible();
  });

  test('the CTA stays clear of the bottom inset', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true, safeAreaTop: 59, safeAreaBottom: 34 });
    await openModeChooser(page);
    await page.getByTestId('mode-quick').click();
    await tapStar(page, 3);

    const cta = await page.getByTestId('quick-continue').boundingBox();
    const viewport = page.viewportSize()!;
    expect(cta).not.toBeNull();
    // 34px home indicator: the button must end above it.
    expect(cta!.y + cta!.height).toBeLessThanOrEqual(viewport.height - 34);
  });

  test('every star is a real 44px touch target', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeChooser(page);
    await page.getByTestId('mode-quick').click();

    for (const star of await stars(page).all()) {
      const box = (await star.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});

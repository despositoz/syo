import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { cssVar, isTelegramBackVisible, mockTelegram, mockTmdb, pressTelegramBack } from './fixtures';

/** Film page → "Начать оценку" → mode selector. */
const openModeSelector = async (page: Page) => {
  await page.goto('/');
  await page.getByText('Фильм 101').click();
  await expect(page.getByTestId('film-title')).toBeAttached();
  await page.getByRole('button', { name: 'Начать оценку' }).click();
  await expect(page.getByTestId('mode-detailed')).toBeVisible();
};

/** Drags the slider to the centre of the n-th star (1-5). */
const dragToStar = async (page: Page, star: number) => {
  const slider = page.getByTestId('star-rating');
  const box = await slider.boundingBox();
  if (!box) throw new Error('star control has no box');

  const stars = page.locator('[data-testid="star-rating"] [class*="star__"]');
  const target = await stars.nth(star - 1).boundingBox();
  if (!target) throw new Error('star has no box');

  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
};

const tapStar = async (page: Page, star: number) => {
  const stars = page.locator('[data-testid="star-rating"] [class*="star__"]');
  await stars.nth(star - 1).click();
};

test.describe('Rating flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
  });

  test('the mode selector offers both paths and creates no draft on its own', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeSelector(page);

    await expect(page.getByText('Как хочешь оценить?')).toBeVisible();
    await expect(page.getByTestId('mode-detailed')).toContainText('Разобрать впечатление');
    await expect(page.getByTestId('mode-quick')).toContainText('Быстрая оценка');

    // Merely looking at the selector must not leave a draft behind.
    const draftBefore = await page.evaluate(() => localStorage.getItem('syo:rating-draft:active'));
    expect(draftBefore).toBeNull();
  });

  test('quick rating: no default value, save stays locked until a choice', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeSelector(page);
    await page.getByTestId('mode-quick').click();

    const slider = page.getByTestId('star-rating');
    await expect(slider).toBeVisible();
    // Nothing is pre-selected — no 3/5, no half scale.
    await expect(slider).not.toHaveAttribute('aria-valuenow', /.*/);
    await expect(slider).toHaveAttribute('aria-valuetext', 'Оценка не выбрана');
    await expect(page.getByText('Проведи по звёздам')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить оценку' })).toBeDisabled();

    await tapStar(page, 4);
    await expect(slider).toHaveAttribute('aria-valuenow', '4');
    await expect(page.getByRole('button', { name: 'Сохранить оценку' })).toBeEnabled();
  });

  test('dragging the stars follows the finger and commits the value under it', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeSelector(page);
    await page.getByTestId('mode-quick').click();

    await dragToStar(page, 5);
    await expect(page.getByTestId('star-rating')).toHaveAttribute('aria-valuenow', '5');

    // Dragging back down works just as well.
    await dragToStar(page, 2);
    await expect(page.getByTestId('star-rating')).toHaveAttribute('aria-valuenow', '2');
  });

  test('a deliberate zero is a real value, not an empty one', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeSelector(page);
    await page.getByTestId('mode-quick').click();

    await page.getByTestId('star-rating').focus();
    await page.keyboard.press('Home');

    const slider = page.getByTestId('star-rating');
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    await expect(slider).toHaveAttribute('aria-valuetext', /^0 из 5/);
    await expect(page.getByText('Проведи по звёздам')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Сохранить оценку' })).toBeEnabled();
  });

  test('the whole flow is walkable from the keyboard alone', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeSelector(page);
    await page.getByTestId('mode-detailed').click();

    const aspectNames = [
      'Сюжет',
      'Герои и актёрская игра',
      'Режиссура и визуал',
      'Звук и музыка',
      'Что осталось',
    ];

    for (const name of aspectNames) {
      const slider = page.getByTestId('star-rating');
      // Wait for the panel to actually be this aspect before typing into it.
      await expect(slider).toHaveAttribute('aria-label', name);
      await slider.focus();

      // From "not rated" the first press lands on 1, so four presses give 4.
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      // An arrow never auto-advances; Enter is the deliberate confirmation.
      await expect(slider).toHaveAttribute('aria-valuenow', '4');
      await page.keyboard.press('Enter');
    }

    await expect(page.getByRole('button', { name: 'Сохранить оценку' })).toBeVisible();
    await expect(page.getByText('4 из 5').first()).toBeVisible();
  });

  test('five aspects produce a half-star total that cannot be edited by hand', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeSelector(page);
    await page.getByTestId('mode-detailed').click();

    // 5, 4, 5, 4, 5 → raw 4.6 → display 4.5
    for (const value of [5, 4, 5, 4, 5]) {
      await tapStar(page, value);
      await page.waitForTimeout(650); // settle + auto-advance
    }

    await expect(page.getByText('4,6 из 5').first()).toBeVisible();
    // The overall is computed: no interactive control on the result screen.
    await expect(page.getByTestId('star-rating')).toHaveCount(0);
  });

  test('a draft survives a reload and resumes on the same aspect', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeSelector(page);
    await page.getByTestId('mode-detailed').click();

    await tapStar(page, 4);
    await page.waitForTimeout(650);
    await tapStar(page, 3);
    await page.waitForTimeout(650);

    await expect(page.getByText('Режиссура и визуал')).toBeVisible();

    await page.reload();

    // Same aspect, and the earlier answers are still in the running total.
    await expect(page.getByText('Режиссура и визуал')).toBeVisible();
    await expect(page.getByText('2 из 5')).toBeVisible();
  });

  test('saving lands in the Diary with the film as a card', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true });
    await openModeSelector(page);
    await page.getByTestId('mode-quick').click();

    await tapStar(page, 4);
    // Quick has two steps: the CTA leads to the result, which commits it.
    await page.getByRole('button', { name: 'Сохранить оценку' }).click();
    await expect(page.getByText('Как сложилась оценка')).toHaveCount(0);
    await page.getByRole('button', { name: 'Сохранить оценку' }).click();

    await expect(page.getByRole('heading', { name: 'Дневник' })).toBeVisible();
    await expect(page.getByText('Фильм 101').first()).toBeVisible();

    // And it survives a restart: the entry is local-first, not in memory.
    await page.reload();
    await expect(page.getByText('Фильм 101').first()).toBeVisible();
  });

  test('deleting an entry offers Undo and puts the card back', async ({ page }) => {
    // The longest journey in the suite: rate, save, open, delete, undo.
    test.setTimeout(60_000);
    await mockTelegram(page, { fullscreen: true });
    await openModeSelector(page);
    await page.getByTestId('mode-quick').click();
    await tapStar(page, 4);
    await page.getByRole('button', { name: 'Сохранить оценку' }).click();
    await page.getByRole('button', { name: 'Сохранить оценку' }).click();
    await expect(page.getByRole('heading', { name: 'Дневник' })).toBeVisible();

    // Target the card itself: the film title also appears in the feed beneath.
    await page.locator('[data-testid^="journal-card-"]').first().click();
    await page.getByTestId('entry-menu').click();
    await page.getByTestId('entry-delete').click();
    await page.getByTestId('entry-delete-confirm').click();

    await expect(page.getByText('Оценка удалена')).toBeVisible();
    await page.getByTestId('snackbar-action').click();
    await expect(page.getByText('Фильм 101').first()).toBeVisible();
  });
});

test.describe('Rating flow inside Telegram', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
  });

  test('the bottom bar is hidden and the header clears the system chrome', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true, safeArea: { top: 59, bottom: 34 } });
    await openModeSelector(page);

    // A nested full-screen scenario: no root navigation underneath.
    await expect(page.getByRole('navigation')).toHaveCount(0);

    const backBox = await page.getByTestId('rating-back').boundingBox();
    const safeTop = Number.parseFloat(await cssVar(page, '--content-safe-top'));
    expect(backBox).not.toBeNull();
    expect(backBox!.y).toBeGreaterThanOrEqual(safeTop);
    expect(backBox!.height).toBeGreaterThanOrEqual(44);
  });

  test('non-fullscreen: Telegram owns back and we render none', async ({ page }) => {
    await mockTelegram(page, { fullscreen: false, fullscreenSupported: false });
    await openModeSelector(page);

    expect(await isTelegramBackVisible(page)).toBe(true);
    await expect(page.getByTestId('rating-back')).toHaveCount(0);
  });

  test('the Telegram back button steps back through the aspects', async ({ page }) => {
    await mockTelegram(page, { fullscreen: false, fullscreenSupported: false });
    await openModeSelector(page);
    await page.getByTestId('mode-detailed').click();

    await tapStar(page, 4);
    await page.waitForTimeout(650);
    await expect(page.getByText('Герои и актёрская игра')).toBeVisible();

    await pressTelegramBack(page);
    await expect(page.getByText('Сюжет')).toBeVisible();
  });

  test('the CTA stays clear of the bottom inset', async ({ page }) => {
    await mockTelegram(page, { fullscreen: true, safeArea: { top: 59, bottom: 34 } });
    await openModeSelector(page);
    await page.getByTestId('mode-quick').click();
    await tapStar(page, 3);

    const cta = await page.getByRole('button', { name: 'Сохранить оценку' }).boundingBox();
    const viewport = page.viewportSize()!;
    expect(cta).not.toBeNull();
    // 34px home indicator: the button must end above it.
    expect(cta!.y + cta!.height).toBeLessThanOrEqual(viewport.height - 34);
  });
});

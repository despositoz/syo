import { expect, test } from '@playwright/test';
import { cssVar, mockTelegram, mockTmdb } from './fixtures';

test.describe('Movie Picker', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
  });

  test('opens with the question, not with an eyebrow line', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Оценить' }).click();

    await expect(page.getByRole('heading', { name: 'Что ты посмотрел?' })).toBeVisible();
    await expect(page.getByText('SYO слушает')).toHaveCount(0);
    await expect(page.getByText('Популярное сегодня')).toBeVisible();
    await expect(page.getByLabel('Основная навигация')).toHaveAttribute('aria-hidden', 'true');
  });

  test('does not auto-open the keyboard and uses a 16px input', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Оценить' }).click();

    const input = page.getByPlaceholder('Название фильма');
    await expect(input).toBeVisible();
    await expect(input).not.toBeFocused();

    const fontSize = await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    // Anything below 16px makes iOS Safari zoom the viewport on focus.
    expect(fontSize).toBeGreaterThanOrEqual(16);
  });

  test('does not zoom the page when the field is focused', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Оценить' }).click();

    const before = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    await page.getByPlaceholder('Название фильма').click();
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => window.visualViewport?.scale ?? 1);

    expect(after).toBeCloseTo(before, 2);
  });

  test('searches and opens the result', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Оценить' }).click();
    await page.getByPlaceholder('Название фильма').fill('найд');

    await expect(page.getByText('Найденный фильм')).toBeVisible({ timeout: 5000 });
    await page.getByText('Найденный фильм').click();

    await expect(page.getByTestId('film-title')).toBeVisible();
    await expect(page.getByText('Режиссёр Тест')).toBeVisible();
  });

  test('keeps content clear of the keyboard inset variable', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Оценить' }).click();

    // The variable exists and is a valid length even with no keyboard.
    expect(await cssVar(page, '--keyboard-height')).toMatch(/^\d+px$/);
  });
});

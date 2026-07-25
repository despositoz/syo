import { expect, test } from '@playwright/test';
import {
  cssVar,
  isTelegramBackVisible,
  mockTelegram,
  mockTmdb,
  pressTelegramBack,
  telegramCalls,
} from './fixtures';

test.describe('Telegram Mini App shell', () => {
  test('boots straight into the feed, without requesting fullscreen first', async ({ page }) => {
    await mockTmdb(page);
    await mockTelegram(page, { fullscreen: false });
    await page.goto('/');

    await expect(page.getByText('Фильм 101')).toBeVisible();
    await expect(page.getByLabel('Основная навигация')).toBeVisible();

    const calls = await telegramCalls(page);
    expect(calls).toContain('ready');
    expect(calls).toContain('expand');
    expect(calls).not.toContain('requestFullscreen');
  });

  test('requests fullscreen once, after the first deliberate action', async ({ page }) => {
    await mockTmdb(page);
    await mockTelegram(page, { fullscreen: false });
    await page.goto('/');
    await page.getByText('Фильм 101').click();

    await expect(page.getByTestId('film-title')).toBeVisible();
    const calls = await telegramCalls(page);
    expect(calls.filter((call) => call === 'requestFullscreen')).toHaveLength(1);
  });

  test('non-fullscreen: Telegram owns the back button, we render none', async ({ page }) => {
    await mockTmdb(page);
    // A client that cannot go fullscreen stays in Telegram chrome.
    await mockTelegram(page, { fullscreen: false, version: '6.9' });
    await page.addInitScript(() => {
      const webApp = (window as never as { Telegram: { WebApp: Record<string, unknown> } }).Telegram
        .WebApp;
      webApp.requestFullscreen = undefined;
      webApp.isVersionAtLeast = () => false;
    });
    await page.goto('/');
    await page.getByText('Фильм 101').click();

    await expect(page.getByTestId('film-title')).toBeVisible();
    await expect(page.getByTestId('app-back-button')).toHaveCount(0);
    expect(await isTelegramBackVisible(page)).toBe(true);
  });

  test('fullscreen: we own the back button, Telegram hides its own', async ({ page }) => {
    await mockTmdb(page);
    await mockTelegram(page, { fullscreen: true });
    await page.goto('/');
    await page.getByText('Фильм 101').click();

    await expect(page.getByTestId('app-back-button')).toBeVisible();
    expect(await isTelegramBackVisible(page)).toBe(false);
  });

  test('the Telegram back button closes the film page', async ({ page }) => {
    await mockTmdb(page);
    await mockTelegram(page, { fullscreen: false, version: '6.9' });
    await page.addInitScript(() => {
      const webApp = (window as never as { Telegram: { WebApp: Record<string, unknown> } }).Telegram
        .WebApp;
      webApp.requestFullscreen = undefined;
      webApp.isVersionAtLeast = () => false;
    });
    await page.goto('/');
    await page.getByText('Фильм 101').click();
    await expect(page.getByTestId('film-title')).toBeVisible();

    await pressTelegramBack(page);

    await expect(page.getByTestId('film-title')).toHaveCount(0);
    await expect(page.getByLabel('Основная навигация')).toBeVisible();
  });

  test('normalizes Telegram insets into CSS variables exactly once', async ({ page }) => {
    await mockTmdb(page);
    await mockTelegram(page, {
      fullscreen: true,
      safeAreaTop: 59,
      safeAreaBottom: 34,
      contentSafeAreaTop: 46,
    });
    await page.goto('/');
    await expect(page.getByText('Фильм 101')).toBeVisible();

    expect(await cssVar(page, '--safe-top')).toBe('59px');
    expect(await cssVar(page, '--content-safe-top')).toBe('105px');
    expect(await cssVar(page, '--safe-bottom')).toBe('34px');
  });

  test('controls stay clear of the Telegram system chrome', async ({ page }) => {
    await mockTmdb(page);
    await mockTelegram(page, { fullscreen: true, contentSafeAreaTop: 46 });
    await page.goto('/');
    await page.getByText('Фильм 101').click();

    const back = page.getByTestId('app-back-button');
    await expect(back).toBeVisible();

    const box = (await back.boundingBox())!;
    const safeTop = Number((await cssVar(page, '--content-safe-top')).replace('px', ''));

    // Below the Telegram control band…
    expect(box.y).toBeGreaterThanOrEqual(safeTop - 1);
    // …and a real 44×44 touch target (device-pixel rounding tolerated).
    expect(box.width).toBeGreaterThanOrEqual(43.5);
    expect(box.height).toBeGreaterThanOrEqual(43.5);
  });

  test('the bottom bar sits above the system inset and hides on the film page', async ({
    page,
  }) => {
    await mockTmdb(page);
    await mockTelegram(page, { fullscreen: true, safeAreaBottom: 34 });
    await page.goto('/');

    const bar = page.getByLabel('Основная навигация');
    await expect(bar).toBeVisible();

    const box = (await bar.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 34 + 1);

    await page.getByText('Фильм 101').click();
    await expect(page.getByTestId('film-title')).toBeVisible();
    await expect(bar).toHaveAttribute('aria-hidden', 'true');
  });

  test('the app never scrolls horizontally', async ({ page }) => {
    await mockTmdb(page, { title: 'Очень длинное название фильма без единого переноса строки' });
    await mockTelegram(page, { fullscreen: true });
    await page.goto('/');
    await expect(page.getByText(/Очень длинное название/)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

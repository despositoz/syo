import { expect, test } from '@playwright/test';
import { mockTelegram, mockTmdb } from './fixtures';

test.describe('Reduce Motion and viewport sizes', () => {
  test('marks reduced motion on the document and still navigates', async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');

    await page.getByText('Фильм 101').click();
    await expect(page.getByTestId('film-title')).toBeVisible();

    await page.getByTestId('app-back-button').click();
    await expect(page.getByTestId('film-title')).toHaveCount(0);
  });

  test('the app fills the Telegram viewport height', async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
    await page.goto('/');
    await expect(page.getByText('Фильм 101')).toBeVisible();

    const { shellHeight, viewportHeight } = await page.evaluate(() => {
      const shell = document.querySelector('#root > div');
      return {
        shellHeight: shell ? Math.round(shell.getBoundingClientRect().height) : 0,
        viewportHeight: window.innerHeight,
      };
    });

    expect(Math.abs(shellHeight - viewportHeight)).toBeLessThanOrEqual(2);
  });

  test('a very long title does not overflow the viewport', async ({ page }) => {
    await mockTmdb(page, {
      logo: 'none',
      title:
        'Невероятно длинное название фильма которое обязано переноситься а не ломать вёрстку экрана',
    });
    await mockTelegram(page, { fullscreen: true });
    await page.goto('/');
    await page
      .getByText(/Невероятно длинное/)
      .first()
      .click();

    await expect(page.getByTestId('film-title')).toBeVisible();
    const box = (await page.getByTestId('film-title').boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  });

  test('every interactive control meets the 44 px touch minimum', async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
    await page.goto('/');
    await expect(page.getByText('Фильм 101')).toBeVisible();

    const tooSmall = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('button'));
      return nodes
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return false;
          return rect.height < 43.5;
        })
        .map((node) => node.getAttribute('aria-label') ?? node.textContent?.trim() ?? '?');
    });

    expect(tooSmall).toEqual([]);
  });
});

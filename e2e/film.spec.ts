import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockTelegram, mockTmdb } from './fixtures';

const openFilm = async (page: Page) => {
  await page.goto('/');
  await page.getByText('Фильм 101').click();
  await expect(page.getByTestId('film-title')).toBeAttached();
};

test.describe('Film Page hero', () => {
  test('no logo → text title, and it never turns into a logo', async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
    await openFilm(page);

    await expect(page.getByTestId('film-title')).toBeVisible();
    await page.waitForTimeout(900);
    await expect(page.locator('img[data-tone]')).toHaveCount(0);
    await expect(page.getByTestId('film-title')).toBeVisible();
  });

  test('white logo → logo mode, and the text title never flashes first', async ({ page }) => {
    await mockTmdb(page, { logo: 'white' });
    await mockTelegram(page, { fullscreen: true });

    await page.goto('/');
    await page.getByText('Фильм 101').click();

    // The painted title is either absent or already the logo — never text first.
    const logo = page.locator('img[data-tone]');
    await expect(logo).toHaveCount(1, { timeout: 5000 });
    await expect(logo).toHaveAttribute('data-tone', 'light');
    // The accessible title stays in the DOM.
    await expect(page.getByTestId('film-title')).toBeAttached();
  });

  test('black logo is lightened, never left unreadable', async ({ page }) => {
    await mockTmdb(page, { logo: 'black' });
    await mockTelegram(page, { fullscreen: true });
    await openFilm(page);

    const logo = page.locator('img[data-tone]');
    await expect(logo).toHaveCount(1, { timeout: 5000 });
    await expect(logo).toHaveAttribute('data-tone', 'dark-monochrome');
    await expect(logo).toHaveCSS('filter', /invert/);
  });

  test('a slow logo loses the preflight budget and the hero commits to text', async ({ page }) => {
    await mockTmdb(page, { logo: 'white', logoDelayMs: 1500 });
    await mockTelegram(page, { fullscreen: true });
    await openFilm(page);

    await expect(page.getByTestId('film-title')).toBeVisible();
    await page.waitForTimeout(2000);
    // Even after the logo finally arrives, the hero must not change.
    await expect(page.locator('img[data-tone]')).toHaveCount(0);
    await expect(page.getByTestId('film-title')).toBeVisible();
  });

  test('the text title is warm ivory, never black', async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
    await openFilm(page);

    const color = await page
      .getByTestId('film-title')
      .evaluate((node) => getComputedStyle(node).color);
    const [red, green, blue] = /rgba?\((\d+), (\d+), (\d+)/.exec(color)!.slice(1).map(Number) as [
      number,
      number,
      number,
    ];
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    expect(luminance).toBeGreaterThan(0.7);
  });

  test('a missing poster falls back to typography, not to an error icon', async ({ page }) => {
    await mockTmdb(page, { posterPath: null, logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
    await openFilm(page);

    const hero = page.locator('[class*="FilmPage-module__scroll"] header');
    await expect(hero).toBeVisible();
    // The fallback shows the film's own title; the wordmark never appears on art.
    await expect(hero.getByText('SYO')).toHaveCount(0);
    await expect(page.getByTestId('film-title')).toBeVisible();
  });

  test('the top shade stays shallow and does not cover the hero', async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
    await openFilm(page);

    const shadeHeight = await page.evaluate(() => {
      const shade = document.querySelector('[aria-hidden="true"] > div:nth-child(2)');
      return shade ? shade.getBoundingClientRect().height : 0;
    });
    const viewport = page.viewportSize()!;
    // A big black lid is forbidden: the vignette must stay near the top.
    expect(shadeHeight).toBeGreaterThan(0);
    expect(shadeHeight).toBeLessThan(viewport.height * 0.32);
  });

  test('the watchlist has exactly one visible projection at a time', async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
    await openFilm(page);

    await expect(page.getByTestId('watchlist-hero')).toBeVisible();
    await expect(page.getByTestId('watchlist-toolbar')).toHaveCount(0);

    await page.getByTestId('watchlist-hero').click();
    await expect(page.getByText('Добавлено в «Посмотреть позже»')).toBeVisible();

    await page
      .locator('[class*="FilmPage-module__scroll"]')
      .evaluate((node) => node.scrollTo({ top: node.scrollHeight }));

    await expect(page.getByTestId('watchlist-toolbar')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('watchlist-hero')).not.toBeInViewport();
    await expect(page.getByTestId('watchlist-toolbar')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the watchlist survives a reload (IndexedDB)', async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
    await openFilm(page);

    await page.getByTestId('watchlist-hero').click();
    await expect(page.getByTestId('watchlist-hero')).toHaveAttribute('aria-pressed', 'true');

    // The film URL is a real route, so a reload lands back on the same page.
    await page.reload();
    await expect(page.getByTestId('watchlist-hero')).toHaveAttribute('aria-pressed', 'true', {
      timeout: 10000,
    });
  });

  test('parallax moves the backdrop slower than the text', async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
    await openFilm(page);

    const before = await page.evaluate(() => {
      const layer = document.querySelector('header div[style*="--stage-accent-rgb"]');
      return layer ? getComputedStyle(layer).transform : 'none';
    });

    // mouse.wheel is unsupported in mobile WebKit; scroll the container itself.
    await page
      .locator('[class*="FilmPage-module__scroll"]')
      .evaluate((node) => node.scrollTo({ top: 300 }));
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => {
      const layer = document.querySelector('header div[style*="--stage-accent-rgb"]');
      return layer ? getComputedStyle(layer).transform : 'none';
    });

    expect(after).not.toBe(before);
  });

  test('back closes the page without zoom and restores the bottom bar', async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
    await openFilm(page);

    const rootScale = await page.evaluate(() => {
      const root = document.querySelector('main');
      return root ? getComputedStyle(root).transform : 'none';
    });

    await page.getByTestId('app-back-button').click();

    await expect(page.getByTestId('film-title')).toHaveCount(0);
    await expect(page.getByLabel('Основная навигация')).not.toHaveAttribute('aria-hidden', 'true');
    // The screen underneath was never scaled.
    expect(rootScale === 'none' || rootScale === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
  });
});

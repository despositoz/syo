import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockTelegram, mockTmdb } from './fixtures';
import { diaryText, seedDiary, seedFilms } from './helpers/seed';

/**
 * Deliverable artefacts (P0.3.1 §23.6, §23.7): screenshots of the screens the
 * spec lists, plus a recording of a window resized from 900px down to 280px.
 *
 * Run explicitly — it produces files, it does not assert behaviour:
 *   npx playwright test e2e/artifacts.spec.ts --project=iphone
 */

const OUT = 'docs/screenshots';

// Video for the whole file: Playwright cannot switch it on inside a describe.
test.use({ video: { mode: 'on', size: { width: 900, height: 800 } } });

const shoot = (page: Page, name: string) =>
  page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });

const openDiary = async (page: Page) => {
  await page.goto('/');
  await seedDiary(page, {
    count: 6,
    overrides: (index) =>
      index === 0
        ? {
            mode: 'deep',
            overallRating: 5,
            preciseRating: 4.6,
            aspects: { story: 5, characters: 5, direction: 4, sound: 4, aftertaste: 5 },
            hasText: true,
            text: diaryText('Фильм оставил тишину, которую не хочется нарушать.'),
          }
        : index === 1
          ? { hasText: true, text: diaryText('В финале все умирают', true) }
          : {},
  });
  await page.goto('/diary');
  await page.locator('[data-testid^="diary-card-"]').first().waitFor();
};

const startWriting = async (page: Page) => {
  await page.goto('/');
  await page.getByTestId('feed-open-film').first().click();
  await page
    .getByRole('button', { name: /Начать оценку|Продолжить оценку|Изменить оценку/ })
    .click();
  await page.getByTestId('mode-quick').click();
  await page.getByRole('radio').nth(3).click();
  await page.getByTestId('quick-continue').click();
};

test.describe('artefacts', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
  });

  test('diary at 393, 320 grid and 320 list', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await openDiary(page);
    await shoot(page, 'diary-393-grid');

    await page.setViewportSize({ width: 320, height: 700 });
    await shoot(page, 'diary-320-grid');

    await page.getByTestId('view-list').click();
    await shoot(page, 'diary-320-list');
  });

  test('active draft, rating hero and editor at 320', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await startWriting(page);
    await shoot(page, 'rating-hero-320');

    await page.getByTestId('result-save-and-write').click();
    await page.getByTestId('writing-mode-free').click();
    await page.getByTestId('writing-textarea').fill('Фильм оставил тишину.');
    await shoot(page, 'editor-320');

    await page.addStyleTag({ content: 'html { font-size: 32px; }' });
    await shoot(page, 'editor-320-text-200');

    // An unfinished text is what the draft card shows in the Diary.
    await page.goto('/diary');
    await page.getByTestId('active-draft-card').waitFor();
    await shoot(page, 'active-draft-320');
  });

  test('desktop narrow and wide', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await openDiary(page);
    await shoot(page, 'desktop-narrow-900');

    await page.setViewportSize({ width: 1440, height: 900 });
    await shoot(page, 'desktop-wide-1440');
  });
});

test.describe('feed artefacts', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
    await page.setViewportSize({ width: 393, height: 852 });
  });

  test('cold start and a personalised feed', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-feed-item]').first().waitFor();
    await shoot(page, 'feed-cold-start');

    // Rate films the mock does not serve as trending, so recommendations and
    // observations have something to work from — and cache their genres and
    // directors, which is what the insight engine actually reads.
    await seedFilms(
      page,
      Array.from({ length: 9 }, (_, index) => ({
        id: 900 + index,
        genres: index % 2 === 0 ? ['фантастика', 'драма'] : ['драма'],
        director: index % 3 === 0 ? 'Дени Вильнёв' : `Режиссёр ${index}`,
      })),
    );
    await seedDiary(page, {
      count: 9,
      overrides: (index) => ({
        filmId: 900 + index,
        filmTitle: `Фильм ${900 + index}`,
        overallRating: index % 3 === 0 ? 5 : 4,
        preciseRating: index % 3 === 0 ? 5 : 4,
      }),
    });
    await page.goto('/');
    await page.locator('[data-feed-item]').first().waitFor();
    await page.waitForTimeout(600);
    await shoot(page, 'feed-personal');

    const why = page.getByTestId('feed-why').first();
    if (await why.count()) {
      await why.click();
      await shoot(page, 'feed-why-sheet');
    }
  });

  test('the feed at 320 and in a wide window', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/');
    await page.locator('[data-feed-item]').first().waitFor();
    await shoot(page, 'feed-320');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(200);
    await shoot(page, 'feed-desktop-wide');
  });
});

test.describe('resize recording', () => {
  test('scrolling the feed slowly, for the parallax', async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto('/');
    await page.locator('[data-feed-item]').first().waitFor();

    for (let step = 0; step < 40; step += 1) {
      await page.getByTestId('feed-scroll').evaluate((node) => node.scrollBy(0, 40));
      await page.waitForTimeout(50);
    }
  });

  test('a window shrinking from 900 to 280 never overlaps a card', async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: false });
    await page.setViewportSize({ width: 900, height: 800 });
    await openDiary(page);

    // One pass down and back up, slowly enough to watch.
    for (let width = 900; width >= 280; width -= 20) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(60);
    }
    for (let width = 280; width <= 900; width += 40) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(40);
    }
  });
});

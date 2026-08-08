import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockTelegram, mockTmdb } from './fixtures';
import { seedDiary, seedFilms } from './helpers/seed';
import { expectInsideViewport, expectNoOverlap } from './helpers/layout';

/**
 * The profile and the taste signature (P0.5).
 *
 * The questions here are the ones a user would ask: does it claim anything it
 * cannot show, can I check where a conclusion came from, and does my own
 * writing stay mine.
 */

const openProfile = async (page: Page) => {
  await page.goto('/profile');
  await expect(page.getByTestId('profile-identity')).toBeVisible();
};

/** An archive with a real pattern: science fiction rated high, one director. */
const seedArchive = async (page: Page, count: number) => {
  await page.goto('/');
  await seedFilms(
    page,
    Array.from({ length: count }, (_, index) => ({
      id: 900 + index,
      title: `Картина ${index + 1}`,
      genres: index % 2 === 0 ? ['фантастика', 'драма'] : ['драма'],
      director: index % 3 === 0 ? 'Дени Вильнёв' : `Режиссёр ${index}`,
    })),
  );
  await seedDiary(page, {
    count,
    overrides: (index) => ({
      filmId: 900 + index,
      filmTitle: `Картина ${index + 1}`,
      overallRating: index % 2 === 0 ? 5 : 3,
      preciseRating: index % 2 === 0 ? 5 : 3,
    }),
  });
};

test.describe('Profile', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
  });

  test('an empty archive claims nothing about taste', async ({ page }) => {
    await openProfile(page);

    await expect(page.getByTestId('profile-cold-start')).toBeVisible();
    await expect(page.getByTestId('taste-hero')).toContainText('Здесь появится твой почерк');
    // Not one word pretending to know something.
    await expect(page.getByText(/держится выше|чаще всего поднимает/)).toHaveCount(0);
  });

  test('says where the signature is computed', async ({ page }) => {
    await openProfile(page);
    await expect(page.getByTestId('profile-privacy')).toContainText('на этом устройстве');
  });

  test('three ratings form a hedged portrait, never a confident one', async ({ page }) => {
    await seedArchive(page, 3);
    await openProfile(page);

    await expect(page.getByTestId('taste-confidence')).toContainText('3');
    const headline = await page.getByTestId('taste-headline').textContent();
    expect(headline).toMatch(/Пока|складывается/);
  });

  test('a full archive earns a signature with checkable evidence', async ({ page }) => {
    await seedArchive(page, 16);
    await openProfile(page);

    await expect(page.getByTestId('taste-headline')).toBeVisible();
    await page.getByTestId('taste-open').click();

    await expect(page.getByTestId('taste-page-headline')).toBeVisible();
    const why = page.getByTestId('taste-why').first();
    await expect(why).toHaveAttribute('aria-expanded', 'false');

    await why.click();
    await expect(why).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('evidence-list').first()).toBeVisible();
    // Real films with real ratings, not weights or formulas.
    await expect(page.getByTestId('evidence-film').first()).toContainText('Твоя оценка');
  });

  test('the method is explained and the text is never read', async ({ page }) => {
    await seedArchive(page, 16);
    await openProfile(page);
    await page.getByTestId('taste-open').click();

    const method = page.getByTestId('taste-method');
    await expect(method).toContainText('на этом устройстве');
    await expect(method).toContainText('не читается');
  });

  test('the name can be edited and survives a restart', async ({ page }) => {
    await openProfile(page);
    await page.getByTestId('profile-edit').click();

    const input = page.getByTestId('profile-name-input');
    await input.fill('Севолод');
    await page.getByTestId('profile-save').click();

    await expect(page.getByTestId('profile-name')).toHaveText('Севолод');
    await page.reload();
    await expect(page.getByTestId('profile-name')).toHaveText('Севолод');
  });

  test('closing the editor with unsaved changes asks first', async ({ page }) => {
    await openProfile(page);
    await page.getByTestId('profile-edit').click();
    await page.getByTestId('profile-name-input').fill('Другое имя');

    await page.getByTestId('profile-cancel').click();
    await expect(page.getByTestId('profile-discard')).toBeVisible();

    await page.getByTestId('profile-discard').click();
    await expect(page.getByTestId('profile-name')).not.toHaveText('Другое имя');
  });

  test('an empty name cannot be saved', async ({ page }) => {
    await openProfile(page);
    await page.getByTestId('profile-edit').click();
    await page.getByTestId('profile-name-input').fill('   ');

    await expect(page.getByTestId('profile-save')).toBeDisabled();
    await expect(page.getByText('Имя не может быть пустым')).toBeVisible();
  });

  test('favourites are reordered without a drag and saved at once', async ({ page }) => {
    await seedArchive(page, 6);
    await page.evaluate(async () => {
      const open = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('syo');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('profiles', 'readwrite');
        tx.objectStore('profiles').put({
          id: 'local',
          displayName: 'Ты',
          bio: null,
          telegramFirstName: null,
          telegramLastName: null,
          telegramPhotoUrl: null,
          favoriteFilmIds: [900, 901, 902],
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
          schemaVersion: 1,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });

    await openProfile(page);
    await expect(page.getByTestId('favorite-film')).toHaveCount(3);

    await page.getByTestId('favorites-edit').click();
    const rows = page.getByTestId('favorite-editor-row');
    await expect(rows).toHaveCount(3);

    // The first film cannot go further left, the last cannot go right.
    await expect(page.getByTestId('favorite-move-left').first()).toBeDisabled();
    await page.getByTestId('favorite-move-right').first().click();

    await page.reload();
    await page.getByTestId('favorites-edit').click();
    await expect(rows.first()).toContainText('Картина 2');
  });

  test('settings persist across a restart', async ({ page }) => {
    await openProfile(page);
    await page.getByTestId('profile-settings').click();

    await page.getByTestId('settings-theme-graphite').check();
    await page.getByTestId('settings-motion-calm').check();

    await page.reload();
    await expect(page.getByTestId('settings-theme-graphite')).toBeChecked();
    await expect(page.getByTestId('settings-motion-calm')).toBeChecked();
  });

  test('export says what is inside before it writes anything', async ({ page }) => {
    await seedArchive(page, 4);
    await openProfile(page);
    await page.getByTestId('profile-settings').click();
    await page.getByTestId('settings-export').click();

    await expect(page.getByRole('dialog')).toContainText('личные записи');
    const download = page.waitForEvent('download');
    await page.getByTestId('export-confirm').click();

    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^syo-export-\d{4}-\d{2}-\d{2}\.json$/);
  });

  test('erasing everything takes two deliberate steps and can be stopped', async ({ page }) => {
    await seedArchive(page, 4);
    await openProfile(page);
    await page.getByTestId('profile-settings').click();

    await page.getByTestId('settings-clear').click();
    await page.getByTestId('clear-cancel').click();
    // Nothing happened: the diary is still there.
    await page.goto('/diary');
    await expect(page.locator('[data-testid^="diary-card-"]').first()).toBeVisible();
  });

  test('nothing overflows at 280px', async ({ page }) => {
    await page.setViewportSize({ width: 280, height: 653 });
    await seedArchive(page, 16);
    await openProfile(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expectInsideViewport(page, page.getByTestId('taste-hero'), 'taste hero @280');
  });

  test('200% text keeps the controls apart', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await seedArchive(page, 8);
    await openProfile(page);
    await page.addStyleTag({ content: 'html { font-size: 32px; }' });

    const buttons = page.locator('button:visible');
    await expectNoOverlap(buttons, 'profile controls @200%');
    await expectInsideViewport(page, buttons, 'profile controls @200%');
  });

  test('every action is reachable from the keyboard', async ({ page }) => {
    await seedArchive(page, 16);
    await openProfile(page);

    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .filter((button) => button.tabIndex >= 0)
        .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim() ?? ''),
    );

    expect(labels).toContain('Настройки');
    expect(labels.some((label) => /Изменить/.test(label))).toBe(true);
    expect(labels.some((label) => /Посмотреть полностью/.test(label))).toBe(true);
  });
});

import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { cssVar, mockTelegram, mockTmdb } from './fixtures';

/**
 * Writing a text, in a real browser (spec §9-§21).
 *
 * The assistant is answered by an intercepted route, so no request ever leaves
 * the machine — which is also the point being tested: the app talks to its own
 * endpoint and to nothing else.
 */

/** Rates a film and saves it, leaving the saved entry on screen. */
const saveRating = async (page: Page) => {
  await page.goto('/');
  await page.getByTestId('feed-open-film').first().click();
  await expect(page.getByTestId('film-title')).toBeAttached();
  await page
    .getByRole('button', { name: /Начать оценку|Продолжить оценку|Изменить оценку/ })
    .click();
  await page.getByTestId('mode-quick').click();
  await page.getByRole('radio').nth(3).click();
  await page.getByTestId('quick-continue').click();
};

const openWriting = async (page: Page) => {
  await saveRating(page);
  await page.getByTestId('result-save-and-write').click();
  await expect(page.getByTestId('writing-mode')).toBeVisible();
};

/** Answers the assistant endpoint, and records what was asked. */
const mockAssistant = async (
  page: Page,
  reply: (body: Record<string, unknown>) => Record<string, unknown> | { status: number },
) => {
  const seen: Record<string, unknown>[] = [];
  await page.route('**/api/assistant', async (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    seen.push({ ...body, headers: route.request().headers() });

    const answer = reply(body);
    if ('status' in answer && typeof answer.status === 'number') {
      await route.fulfill({
        status: answer.status,
        body: JSON.stringify({ error: { code: 'providerUnavailable' } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(answer),
    });
  });
  return seen;
};

test.describe('Writing a text', () => {
  test.beforeEach(async ({ page }) => {
    await mockTmdb(page, { logo: 'none' });
    await mockTelegram(page, { fullscreen: true });
  });

  test('offers writing after a rating and saves the text onto the entry', async ({ page }) => {
    test.setTimeout(60_000);
    await openWriting(page);

    await page.getByTestId('writing-mode-free').click();
    await page
      .getByTestId('writing-textarea')
      .fill('Фильм оставил тишину, которую не хочется нарушать.');

    await page.getByTestId('writing-to-preview').click();
    await expect(page.getByTestId('writing-preview-text')).toContainText('тишину');

    await page.getByTestId('writing-save').click();

    // Saving crosses a storage write and a route change; under a loaded
    // machine that is slower than the default five seconds.
    await expect(page.getByTestId('entry-text-body')).toContainText('не хочется нарушать', {
      timeout: 15000,
    });
    // Local-first: the text is there after a restart, with no network involved.
    await page.reload();
    await expect(page.getByTestId('entry-text-body')).toContainText('не хочется нарушать', {
      timeout: 15000,
    });
  });

  test('the draft survives a reload mid-sentence', async ({ page }) => {
    test.setTimeout(60_000);
    await openWriting(page);
    await page.getByTestId('writing-mode-free').click();
    await page.getByTestId('writing-textarea').fill('Незаконченная мысль');
    // Blur flushes what is pending; the reload must then find it.
    await page.getByTestId('writing-textarea').blur();

    await page.reload();
    await expect(page.getByTestId('writing-textarea')).toHaveValue('Незаконченная мысль');
  });

  test('the editor and its CTA stay clear of the system inset', async ({ page }) => {
    await openWriting(page);
    await page.getByTestId('writing-mode-free').click();
    await page.getByTestId('writing-textarea').fill('Текст');

    const cta = page.getByTestId('writing-to-preview');
    const box = (await cta.boundingBox())!;
    const bottomInset = Number((await cssVar(page, '--safe-bottom')).replace('px', '')) || 0;
    const viewport = page.viewportSize()!;

    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - bottomInset + 1);
    // Every control is a real touch target.
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test('SYO proposes, the user decides', async ({ page }) => {
    test.setTimeout(60_000);
    // The id is echoed, exactly as the real backend does: a response carrying
    // someone else's id is treated as stale and dropped.
    const seen = await mockAssistant(page, (body) => ({
      requestId: body.requestId,
      promptVersion: 'correct-1',
      text: 'Исправленный текст',
      changeSummary: 'Поправил опечатки',
    }));

    await openWriting(page);
    await page.getByTestId('writing-mode-free').click();
    await page.getByTestId('writing-textarea').fill('Тескт с ашипкой');
    await page.getByTestId('writing-op-correct').click();

    await expect(page.getByTestId('writing-candidate')).toContainText('Исправленный текст');
    await expect(page.getByTestId('writing-change-summary')).toContainText('опечатки');

    // Both versions are readable before anything is decided.
    await page.getByTestId('writing-toggle-original').click();
    await expect(page.getByTestId('writing-original')).toContainText('Тескт с ашипкой');

    await page.getByTestId('writing-keep-original').click();
    await expect(page.getByTestId('writing-textarea')).toHaveValue('Тескт с ашипкой');

    // The request carried the text and the signature header — and no key.
    expect(seen).toHaveLength(1);
    const request = seen[0]!;
    expect(request.text).toBe('Тескт с ашипкой');
    expect(JSON.stringify(request)).not.toMatch(/sk-|api[-_]?key/i);
  });

  test('accepting keeps the original reachable as a version', async ({ page }) => {
    test.setTimeout(60_000);
    await mockAssistant(page, (body) => ({
      requestId: body.requestId,
      promptVersion: 'correct-1',
      text: 'Причёсанный текст',
      changeSummary: 'Поправил',
    }));

    await openWriting(page);
    await page.getByTestId('writing-mode-free').click();
    await page.getByTestId('writing-textarea').fill('Мой корявый текст');
    await page.getByTestId('writing-op-correct').click();
    await page.getByTestId('writing-accept').click();

    await expect(page.getByTestId('writing-textarea')).toHaveValue('Причёсанный текст');

    await page.getByTestId('writing-versions').click();
    await expect(page.getByText('Мой корявый текст')).toBeVisible();
  });

  test('a failed request changes nothing and offers a retry', async ({ page }) => {
    test.setTimeout(60_000);
    await mockAssistant(page, () => ({ status: 503 }));

    await openWriting(page);
    await page.getByTestId('writing-mode-free').click();
    await page.getByTestId('writing-textarea').fill('Текст, который нельзя потерять');
    await page.getByTestId('writing-op-shorten').click();

    await expect(page.getByTestId('writing-assistant-error')).toBeVisible();
    await expect(page.getByTestId('writing-assistant-retry')).toBeVisible();
    await expect(page.getByTestId('writing-textarea')).toHaveValue(
      'Текст, который нельзя потерять',
    );
  });

  test('a conversation builds the text out of the answers', async ({ page }) => {
    test.setTimeout(60_000);
    let asked = 0;
    await mockAssistant(page, (body) => {
      if (body.operation === 'nextQuestion' || body.operation === 'replaceQuestion') {
        asked += 1;
        return {
          requestId: body.requestId,
          promptVersion: 'question-1',
          question: {
            questionId: `q${asked}`,
            question: `Что зацепило? ${asked}`,
            suggestFinish: asked >= 2,
          },
        };
      }
      return {
        requestId: body.requestId,
        promptVersion: 'collect-1',
        text: 'Собранный из ответов текст',
        changeSummary: 'Собрал из твоих ответов',
      };
    });

    await openWriting(page);
    await page.getByTestId('writing-mode-conversation').click();

    await expect(page.getByTestId('writing-question')).toContainText('Что зацепило?');
    await page.getByTestId('writing-answer').fill('Меня зацепил финал');
    await page.getByTestId('writing-answer-send').click();

    await page.getByTestId('writing-compose').click();
    await expect(page.getByTestId('writing-candidate')).toContainText('Собранный из ответов текст');
  });

  test('the whole editor is reachable from the keyboard alone', async ({ page }) => {
    await openWriting(page);
    await page.getByTestId('writing-mode-free').click();

    await page.getByTestId('writing-textarea').focus();
    await page.keyboard.type('Написано с клавиатуры');
    await expect(page.getByTestId('writing-textarea')).toHaveValue('Написано с клавиатуры');

    // Tab reaches the CTA without a pointer anywhere in the flow.
    await page.keyboard.press('Tab');
    for (let step = 0; step < 8; step += 1) {
      const testId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (testId === 'writing-to-preview') break;
      await page.keyboard.press('Tab');
    }
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe(
      'writing-to-preview',
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sheet } from './Sheet';

/**
 * A sheet that asks a question must keep the keyboard inside it: Tab escaping
 * to the page behind means the user can answer a dialog they cannot see.
 */

const open = (onClose = vi.fn()) => {
  render(
    <Sheet open title="Удалить черновик?" onClose={onClose}>
      <button type="button">Первая</button>
      <button type="button">Вторая</button>
    </Sheet>,
  );
  return { onClose };
};

describe('Sheet focus', () => {
  it('moves focus into the dialog when it opens', () => {
    open();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  /*
   * The invariant is containment, not a particular order: jsdom reports every
   * element as invisible (`offsetParent` is always null), so the trap's own
   * visibility filter cannot be exercised here. The order is checked in a real
   * browser by e2e/responsive-layout.spec.ts.
   */
  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button" data-testid="outside">
          Снаружи
        </button>
        <Sheet open title="Удалить черновик?" onClose={vi.fn()}>
          <button type="button">Первая</button>
          <button type="button">Вторая</button>
        </Sheet>
      </>,
    );

    const dialog = screen.getByRole('dialog');
    screen.getByRole('button', { name: 'Вторая' }).focus();

    for (let step = 0; step < 4; step += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(screen.getByTestId('outside'));
  });

  it('returns focus to whatever opened it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button" data-testid="opener">
          Открыть
        </button>
        <div id="host" />
      </>,
    );

    const opener = screen.getByTestId('opener');
    opener.focus();

    const { unmount } = render(
      <Sheet open title="Вопрос" onClose={vi.fn()}>
        <button type="button">Ответ</button>
      </Sheet>,
    );
    expect(document.activeElement).not.toBe(opener);

    unmount();
    expect(document.activeElement).toBe(opener);
    await user.keyboard('{Escape}');
  });
});

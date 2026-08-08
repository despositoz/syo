import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTelegramFake, installFetchMock, renderApp, resetAppState } from './harness';

describe('navigation', () => {
  beforeEach(async () => {
    await resetAppState();
    installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the Movie Picker from the bottom bar and hides the bar', async () => {
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake() });
    await screen.findByText('Тихий свет');

    await user.click(screen.getByRole('button', { name: 'Оценить' }));

    expect(await screen.findByRole('heading', { name: 'Что ты посмотрел?' })).toBeInTheDocument();
    expect(screen.getByLabelText('Основная навигация')).toHaveAttribute('aria-hidden', 'true');
  });

  it('requests fullscreen once, on the first deliberate action', async () => {
    const user = userEvent.setup();
    const telegram = createTelegramFake();
    renderApp({ telegram });
    await screen.findByText('Тихий свет');

    await user.click(screen.getByRole('button', { name: 'Оценить' }));
    await screen.findByRole('heading', { name: 'Что ты посмотрел?' });

    expect(telegram.calls.filter((call) => call === 'requestFullscreen')).toHaveLength(1);
  });

  it('searches and opens the found film', async () => {
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake() });
    await screen.findByText('Тихий свет');

    await user.click(screen.getByRole('button', { name: 'Поиск фильма' }));
    const input = await screen.findByPlaceholderText('Название фильма');
    await user.type(input, 'найд');

    const result = await screen.findByText('Найденный фильм', undefined, { timeout: 4000 });
    await user.click(result);

    expect(await screen.findByTestId('film-title')).toBeInTheDocument();
    expect(await screen.findByText('Режиссёр Тестов')).toBeInTheDocument();
  }, 20000);

  it('does not auto-open the keyboard in the picker', async () => {
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake() });
    await screen.findByText('Тихий свет');

    await user.click(screen.getByRole('button', { name: 'Оценить' }));
    const input = await screen.findByPlaceholderText('Название фильма');

    expect(document.activeElement).not.toBe(input);
  });

  it('shows exactly one back control in Telegram chrome mode', async () => {
    const user = userEvent.setup();
    const telegram = createTelegramFake({ isFullscreen: false });
    renderApp({ telegram });
    await screen.findByText('Тихий свет');

    await user.click(screen.getByRole('button', { name: 'Оценить' }));
    await screen.findByRole('heading', { name: 'Что ты посмотрел?' });

    // Telegram renders the back button; we render none.
    expect(screen.queryByTestId('app-back-button')).not.toBeInTheDocument();
    await waitFor(() => expect(telegram.calls).toContain('back.show'));
  });

  it('shows exactly one back control in fullscreen custom chrome mode', async () => {
    const user = userEvent.setup();
    const telegram = createTelegramFake({ isFullscreen: true });
    renderApp({ telegram });
    await screen.findByText('Тихий свет');

    await user.click(screen.getByRole('button', { name: 'Оценить' }));
    await screen.findByRole('heading', { name: 'Что ты посмотрел?' });

    expect(screen.getByTestId('app-back-button')).toBeInTheDocument();
    expect(telegram.calls).not.toContain('back.show');
  });

  it('closes the picker with our own back button', async () => {
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake({ isFullscreen: true }) });
    await screen.findByText('Тихий свет');

    await user.click(screen.getByRole('button', { name: 'Оценить' }));
    await screen.findByRole('heading', { name: 'Что ты посмотрел?' });

    await user.click(screen.getByTestId('app-back-button'));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Что ты посмотрел?' })).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Основная навигация')).not.toHaveAttribute('aria-hidden');
  });

  it('closes the picker with the Telegram BackButton', async () => {
    const user = userEvent.setup();
    const telegram = createTelegramFake({ isFullscreen: false });
    renderApp({ telegram });
    await screen.findByText('Тихий свет');

    await user.click(screen.getByRole('button', { name: 'Оценить' }));
    await screen.findByRole('heading', { name: 'Что ты посмотрел?' });

    telegram.backPress();

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Что ты посмотрел?' })).not.toBeInTheDocument(),
    );
  });

  it('switches root tabs and keeps the bottom bar visible', async () => {
    const user = userEvent.setup();
    renderApp({ telegram: createTelegramFake() });
    await screen.findByText('Тихий свет');

    const bar = screen.getByLabelText('Основная навигация');
    await user.click(within(bar).getByRole('button', { name: 'Профиль' }));

    // The profile leads with who you are, not with the word "Профиль" (§11.1).
    expect(await screen.findByTestId('profile-identity')).toBeInTheDocument();
    expect(screen.getByLabelText('Основная навигация')).not.toHaveAttribute('aria-hidden');
  });
});

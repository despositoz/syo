import { beforeEach, describe, expect, it } from 'vitest';
import { resolveTheme, useThemeStore } from './themeStore';
import { db } from '@shared/storage/db';

describe('theme resolution', () => {
  it('honours an explicit preference regardless of the system scheme', () => {
    expect(resolveTheme('cinema', 'light')).toBe('cinema');
    expect(resolveTheme('cinema', 'dark')).toBe('cinema');
    expect(resolveTheme('graphite', 'dark')).toBe('graphite');
  });

  it('maps the system scheme onto our hierarchy instead of a light skin', () => {
    expect(resolveTheme('system', 'dark')).toBe('cinema');
    expect(resolveTheme('system', 'light')).toBe('graphite');
  });
});

describe('theme store', () => {
  beforeEach(async () => {
    useThemeStore.setState({ preference: 'cinema', colorScheme: 'dark', resolved: 'cinema' });
    await db.preferences.clear();
  });

  it('re-resolves when the Telegram colour scheme changes', () => {
    useThemeStore.getState().setPreference('system');
    expect(useThemeStore.getState().resolved).toBe('cinema');

    useThemeStore.getState().setColorScheme('light');
    expect(useThemeStore.getState().resolved).toBe('graphite');
  });

  it('persists the preference and restores it on hydrate', async () => {
    useThemeStore.getState().setPreference('graphite');
    // Give the fire-and-forget write a turn to land.
    await new Promise((resolve) => setTimeout(resolve, 0));

    useThemeStore.setState({ preference: 'cinema', resolved: 'cinema' });
    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState().preference).toBe('graphite');
    expect(useThemeStore.getState().resolved).toBe('graphite');
  });

  it('falls back to cinema when the stored value is garbage', async () => {
    await db.preferences.put({ key: 'theme.preference', value: 'neon' });
    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState().preference).toBe('cinema');
  });
});

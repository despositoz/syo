import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  /*
   * Artefacts (screenshots, the resize recording) are produced on request, not
   * on every run: they assert nothing and they write files. Opt in with
   * SYO_ARTIFACTS=1.
   */
  testIgnore: process.env.SYO_ARTIFACTS ? [] : ['**/artifacts.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      // iPhone geometry and touch on Chromium: the default suite needs only
      // one browser download. Set PLAYWRIGHT_WEBKIT=1 for the real WKWebView
      // engine after `npx playwright install webkit`.
      name: 'iphone',
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
    {
      name: 'android',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'reduced-motion',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        contextOptions: { reducedMotion: 'reduce' },
      },
    },
    ...(process.env.PLAYWRIGHT_WEBKIT
      ? [
          {
            name: 'iphone-webkit',
            use: { ...devices['iPhone 13'] },
          },
        ]
      : []),
  ],
  webServer: {
    // A non-empty key only means "TMDB is configured"; every request is mocked.
    command:
      'VITE_TMDB_API_KEY=e2e-key npm run build && npm run preview -- --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

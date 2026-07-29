import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Absolute base: with './' a reload on /film/123 resolves assets against
  // /film/ and 404s. Set VITE_BASE=/subpath/ when hosting under a subdirectory.
  base: process.env.VITE_BASE || '/',
  resolve: {
    alias: {
      '@': resolvePath('./src'),
      '@app': resolvePath('./src/app'),
      '@pages': resolvePath('./src/pages'),
      '@entities': resolvePath('./src/entities'),
      '@domain': resolvePath('./src/domain'),
      '@features': resolvePath('./src/features'),
      '@shared': resolvePath('./src/shared'),
      '@styles': resolvePath('./src/styles'),
    },
  },
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
      generateScopedName: '[name]__[local]__[hash:base64:4]',
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        /*
         * The framework runtime changes far less often than the app does, so
         * it gets its own chunk: a release then invalidates ~90KB of app code
         * instead of the whole bundle.
         */
        manualChunks: {
          vendor: ['react', 'react-dom', 'dexie', 'zustand', '@tanstack/react-query'],
        },
      },
    },
    target: 'es2020',
    cssTarget: 'safari15',
    // Maps help while debugging locally; the published bundle ships without
    // them (VITE_NO_SOURCEMAP=1) so the Pages repo stays small.
    sourcemap: !process.env.VITE_NO_SOURCEMAP,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: true,
    // The backend lives in this repo and is tested with the same runner: its
    // signature check is the one place a mistake would be invisible and fatal.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'server/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
    restoreMocks: true,
    // Whole suites run in parallel on one machine; 5s is the scheduler's
    // patience, not the app's. Assertions still fail fast — only waiting waits.
    testTimeout: 15_000,
  },
});

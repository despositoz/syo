import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // Architectural guardrails from the spec (section 4).
  {
    files: ['src/pages/**/*.{ts,tsx}', 'src/shared/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'UI must not touch storage directly. Use a repository.' },
        {
          name: 'sessionStorage',
          message: 'UI must not touch storage directly. Use a repository.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.object.name='window'][object.object.property.name='Telegram']",
          message: 'UI must not call the Telegram API directly. Use TelegramController.',
        },
        {
          selector: "MemberExpression[object.property.name='Telegram']",
          message: 'UI must not call the Telegram API directly. Use TelegramController.',
        },
        {
          selector: "CallExpression[callee.property.name='querySelector']",
          message: 'No global querySelector architecture. Use refs.',
        },
        {
          selector: "CallExpression[callee.property.name='querySelectorAll']",
          message: 'No global querySelector architecture. Use refs.',
        },
        {
          selector: "CallExpression[callee.name='fetch']",
          message: 'UI must not fetch. Use a repository / TanStack Query.',
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'vitest.setup.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-globals': 'off',
    },
  },
  prettier,
);

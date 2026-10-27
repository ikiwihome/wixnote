import js from '@eslint/js';
import globals from 'globals';
import react from '@eslint-react/eslint-plugin';
import hooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'data/**',
      '.lint-cache/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: { ecmaVersion: 'latest' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.{js,jsx}', 'public/editor/*.js', 'tests/browser/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['server/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.jsx'],
    ...react.configs.recommended,
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { ...react.configs.recommended.plugins, 'react-hooks': hooks },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['disable-naming-convention'].rules,
      // Preserve the existing lint scope during the ESLint 10 migration.
      // Effects reset loading/editor state; dropdown item order is positional.
      '@eslint-react/set-state-in-effect': 'off',
      '@eslint-react/no-array-index-key': 'off',
      // Timer cleanup is handled through finally/pending request maps, and
      // the search focus timer runs once on the next event-loop turn.
      '@eslint-react/web-api-no-leaked-timeout': 'off',
      // Use the existing official Hooks checks rather than duplicate reports.
      '@eslint-react/exhaustive-deps': 'off',
      '@eslint-react/rules-of-hooks': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  prettier,
];

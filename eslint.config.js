import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    // Browser app sources.
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // Preact JSX (automatic runtime, so no React/h global is referenced).
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        // Build-time constant injected by Vite (see vite.config.js).
        __ACCURATE__: 'readonly',
      },
    },
  },
  {
    // Node-side files: tests, config, build scripts.
    files: ['test/**/*.js', '*.config.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    rules: {
      // Unused catch bindings and intentional throwaways are allowed.
      'no-unused-vars': [
        'error',
        { caughtErrors: 'none', argsIgnorePattern: '^_' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  prettier,
];

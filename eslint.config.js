import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.d.ts'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Silent failures hide security-relevant errors.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },

  {
    files: ['packages/api/**/*.ts'],
    rules: {
      // Nest relies on parameter decorators and constructor injection.
      '@typescript-eslint/no-extraneous-class': 'off',

      /*
       * Off here, on everywhere else.
       *
       * The API compiles with `emitDecoratorMetadata`, and Nest reads the
       * emitted `design:paramtypes` to resolve constructor dependencies and to
       * tell ValidationPipe which DTO class a body should be validated against.
       * A type-only import erases the class, so the metadata degrades to
       * `Object`: injection fails at boot, and — far worse, because it is
       * silent — validation is skipped for that endpoint.
       */
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },

  {
    // Seeding and the end-to-end scripts are console programs: their output is
    // the point, not a leftover debug statement.
    files: ['packages/api/prisma/**/*.ts', 'packages/api/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    /*
     * k6 scripts run inside k6's own runtime, not Node: `__ENV`, `__VU` and
     * `__ITER` are injected by it. Declared rather than ignored, so the files
     * still get linted for everything else.
     */
    files: ['packages/api/scripts/load/**/*.js'],
    languageOptions: {
      globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' },
    },
  },

  {
    files: ['packages/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  prettier,
);

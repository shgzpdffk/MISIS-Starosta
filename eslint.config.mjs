import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', '.venv/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  { files: ['public/**/*.js'], languageOptions: { globals: globals.browser } },
  {
    files: ['server/**/*.mjs', 'scripts/**/*.mjs', 'tests/**/*.mjs', '*.config.mjs'],
    languageOptions: { globals: globals.node },
  },
];

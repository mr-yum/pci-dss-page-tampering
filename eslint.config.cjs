const js = require('@eslint/js')
const tseslint = require('typescript-eslint')
const importPlugin = require('eslint-plugin-import-x')
const simpleImportSort = require('eslint-plugin-simple-import-sort')
const jestPlugin = require('eslint-plugin-jest')
const prettierConfig = require('eslint-config-prettier')
const globals = require('globals')

module.exports = tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', '.swc/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      'import-x': importPlugin,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'import-x/no-duplicates': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'max-len': ['warn', { code: 240 }],
      'no-console': 'off',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['src/*'],
              message: 'Use relative imports instead of absolute "src/" imports to ensure proper runtime module resolution.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.(j|t)s', '**/*.spec.(j|t)s', '**/test/**/*.(j|t)s'],
    plugins: {
      jest: jestPlugin,
    },
    rules: {
      'jest/no-disabled-tests': 'warn',
      'jest/no-focused-tests': 'error',
    },
  },
  prettierConfig,
)

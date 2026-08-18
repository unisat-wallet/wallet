module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2020: true,
  },
  globals: {
    chrome: 'readonly',
    NodeJS: 'readonly',
    React: 'readonly',
  },
  extends: ['eslint:recommended', 'prettier'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  plugins: ['@typescript-eslint', 'prettier', 'simple-import-sort', 'unused-imports'],
  rules: {
    // Legacy packages are not yet formatted with the root Prettier version.
    // Keep the signal without making lint unusable while formatting is migrated.
    'prettier/prettier': 'warn',
    'no-unused-vars': 'off',
    // Core no-redeclare does not understand TypeScript declaration merging.
    'no-redeclare': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/prefer-nullish-coalescing': 'warn',
    '@typescript-eslint/prefer-optional-chain': 'warn',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'unused-imports/no-unused-imports': 'warn',
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.spec.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  ],
}

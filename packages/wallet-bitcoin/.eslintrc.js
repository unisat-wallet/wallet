module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  plugins: [
    '@typescript-eslint'
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-var': 'error',
    'no-console': 'warn'
  },
  ignorePatterns: [
    'lib/**/*',
    'dist/**/*',
    'coverage/**/*',
    '*.js',
    '*.mjs'
  ],
  overrides: [
    {
      files: ['test/**/*.{ts,js}', '**/*.test.ts', '**/*.spec.ts'],
      parserOptions: {
        project: null
      },
      rules: {
        '@typescript-eslint/prefer-nullish-coalescing': 'off',
        '@typescript-eslint/prefer-optional-chain': 'off'
      }
    }
  ]
};

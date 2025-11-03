import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/types/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  outDir: 'lib',
  sourcemap: true,
  splitting: false,
  minify: false,
  treeshake: true,
  external: [
    'react',
    'react-redux',
    '@reduxjs/toolkit',
    '@unisat/wallet-types',
    '@unisat/wallet-shared',
    '@unisat/babylon-service',
    '@unisat/keyring-service',
    '@unisat/base-utils',
    '@unisat/i18n',
  ],
})

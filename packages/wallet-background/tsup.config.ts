import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/types/index.ts'],
  format: ['cjs', 'esm'],
  dts: true, // Temporarily disable type generation to focus on functionality completion
  clean: true,
  outDir: 'lib',
  sourcemap: true,
  splitting: false,
  minify: false,
  treeshake: true,
  external: [
    'bitcoinjs-lib',
    '@unisat/keyring-service',
    '@unisat/permission-service',
    '@unisat/wallet-types',
    '@unisat/tx-helpers',
    '@unisat/wallet-api',
    '@unisat/wallet-bitcoin',
    '@unisat/babylon-service',
    '@unisat/contact-book',
    '@unisat/i18n',
    '@unisat/phishing-detect',
    '@unisat/preference-service',
  ],
})

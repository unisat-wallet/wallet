import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: 'lib',
  external: [
    'bitcoinjs-lib',
    'ecpair',
    '@noble/hashes',
    '@noble/secp256k1',
    '@unisat/wallet-types',
    'tiny-secp256k1',
    '@bitcoinerlab/secp256k1',
    'react-native'
  ],
  target: 'es2020',
  tsconfig: './tsconfig.json',
})

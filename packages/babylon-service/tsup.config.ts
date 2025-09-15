import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'types': 'src/types-only.ts',
    'cosmos': 'src/cosmos/index.ts',
    'api': 'src/api/index.ts',
    'utils': 'src/utils/index.ts'
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: 'lib',
  target: 'es2020',
  external: [
    'fs',
    'fs/promises',
    'path'
  ],
  esbuildOptions(options) {
    delete options.packages;
  },
});
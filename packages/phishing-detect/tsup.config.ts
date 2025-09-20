import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: false, // Temporarily disable dts generation
  clean: true,
  sourcemap: true,
  splitting: false,
  minify: false,
  treeshake: true,
  external: []
});
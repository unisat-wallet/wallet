import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      src: resolve(__dirname, './src'),
      // Integration tests also exercise extension components consuming the state hooks.
      '@': resolve(__dirname, '../../apps/extension/src'),
      '@unisat/wallet-state': resolve(__dirname, './src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
    exclude: ['node_modules', 'dist', 'build'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
})

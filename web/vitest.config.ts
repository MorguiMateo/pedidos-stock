import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  tsconfig: fileURLToPath(new URL('./tsconfig.json', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../src', import.meta.url)),
    },
    dedupe: ['react', 'react-dom', '@tanstack/react-query', 'decimal.js'],
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], restoreMocks: true },
});

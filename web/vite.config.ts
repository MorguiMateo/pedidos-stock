import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // Shared pure modules live outside web/. Always transform them with the web
  // configuration, never the repository's Expo-only TypeScript base config.
  tsconfig: fileURLToPath(new URL('./tsconfig.json', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../src', import.meta.url)),
    },
    dedupe: ['react', 'react-dom', '@tanstack/react-query', 'decimal.js'],
  },
  server: { fs: { allow: ['..'] } },
  build: { sourcemap: false, target: 'es2022' },
});

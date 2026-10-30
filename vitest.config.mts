import { defineConfig } from 'vitest/config';

// Android/shared business tests and browser integration tests have separate environments.
export default defineConfig({ test: { include: ['src/**/*.test.{ts,tsx}'] } });

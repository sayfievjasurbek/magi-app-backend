import { defineConfig } from 'vitest/config';

// legacy/ is the replaced academic code: not loaded at runtime, not tested
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['legacy/**', 'node_modules/**'],
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    include: ['tests/**/*.test.ts'],
    fileParallelism: false
  }
});

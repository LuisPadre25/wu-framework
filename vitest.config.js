import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:3000'
      }
    },
    setupFiles: ['./tests/setup.js'],
    globals: true,
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**']
    }
  }
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Node by default (token verification, helpers). Browser-facing suites opt
    // into jsdom with a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    restoreMocks: true,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Tests share one real database (a Neon branch, or the Docker one of
    // `npm run test:docker`): running files one at a time keeps the suites
    // from stepping on each other. Each file still gets a fresh app (and so a
    // fresh rate limiter).
    fileParallelism: false,
    // Generous timeouts: on Neon every query crosses the network.
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});

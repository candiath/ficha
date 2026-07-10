import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Los tests van contra la DB real (Neon, no hay Docker): correr los
    // archivos en serie evita presión de conexiones y que las suites se
    // pisen entre sí. Cada archivo igual tiene su app fresca (y por lo
    // tanto su rate limiter fresco).
    fileParallelism: false,
    // Timeouts generosos: cada query viaja a Neon por la red.
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});

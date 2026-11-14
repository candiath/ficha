import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Config propia en vez de reusar vite.config.ts: los tests no necesitan
// Tailwind ni el server, solo el plugin de React y los alias.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mismo alias que vite.config.ts: sin esto los tests resolverían
      // @ficha/shared al dist de CommonJS y verían otro código que la app.
      '@ficha/shared': path.resolve(import.meta.dirname, '../../packages/shared/src/index.ts'),
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    // jsdom simula el DOM del navegador (document, localStorage, eventos)
    // dentro de Node: es lo que permite montar componentes sin un browser.
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
    // One worker per physical core, not per logical CPU (Vitest's default is
    // all logical CPUs minus one). Each worker renders a jsdom DOM and is
    // CPU-bound, so two on the same core run about 3x slower than one alone:
    // with 11 workers on 6 cores, the form tests took up to 5.6s, past the 5s
    // timeout, and findBy* missed its 1s window. With half, the slowest test
    // stays under 3s, for a run about 5s longer.
    maxWorkers: '50%',
  },
});

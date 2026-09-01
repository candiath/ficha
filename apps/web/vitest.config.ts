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
      '@ficha/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // jsdom simula el DOM del navegador (document, localStorage, eventos)
    // dentro de Node: es lo que permite montar componentes sin un browser.
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
  },
});

import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // escucha en 0.0.0.0 → accesible desde la red local
  },
  resolve: {
    alias: {
      // Al código fuente, no a packages/shared/dist: tsconfig.app.json ya
      // resuelve así para los tipos, y el paquete se compila a CommonJS, que
      // Vite no puede servir tal cual a un browser. Alinear las dos
      // resoluciones evita además bundlear un `dist` viejo que igual typechequea.
      '@ficha/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
})

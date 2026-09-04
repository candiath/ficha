import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Marca del build del front: el SHA corto del commit. Netlify lo expone como
// COMMIT_REF durante el build; fuera de un deploy (npm run dev, build local)
// queda 'local'.
//
// Va por `define` y no por una variable VITE_* del dashboard porque no hay
// nada que configurar: el valor lo sabe el proveedor y no debe poder quedar
// desincronizado a mano. Ver el mismo razonamiento en apps/api/src/app.ts.
const buildMarker = process.env.COMMIT_REF?.slice(0, 7) || 'local'

// https://vite.dev/config/
export default defineConfig({
  define: {
    'import.meta.env.VITE_BUILD_MARKER': JSON.stringify(buildMarker),
  },
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

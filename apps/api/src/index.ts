import 'dotenv/config';
import app from './app';

// Punto de entrada del server: solo carga el entorno y escucha. Toda la
// app (middlewares, rutas, validación de config) vive en app.ts para que
// los tests puedan importarla sin abrir un puerto.
const PORT = process.env.PORT ?? 3001;

app.listen(PORT, () => {
  console.log(`[api] corriendo en http://localhost:${PORT}`);
});

import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

// Códigos de error de Prisma que indican que la base de datos no está disponible.
const DB_UNAVAILABLE_CODES = new Set([
  'P1000', // Authentication failed
  'P1001', // Can’t reach database server
  'P1002', // Database server timed out
  'P1008', // Operations timed out
  'P1017', // Server closed the connection
]);

// Manejador global de errores. Express 5 propaga async errors automáticamente,
// por eso no necesitamos try/catch en cada handler.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // next es requerido por Express para reconocer la firma como error handler
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Datos inválidos',
      details: err.flatten().fieldErrors,
    });
    return;
  }

  // Errores de conexión a la base de datos
  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    (err instanceof Prisma.PrismaClientKnownRequestError &&
      DB_UNAVAILABLE_CODES.has(err.code))
  ) {
    console.error('[db] Base de datos no disponible:', (err as Error).message);
    res.status(503).json({ error: 'Base de datos no disponible' });
    return;
  }

  // Un id que no es UUID llegó a una columna uuid (issue #174). No debería
  // pasar: idParam y IdSchema validan antes. Si pasa, hay un camino sin
  // validar — se responde lo mismo que idParam (no existe) y se loguea fuerte
  // para que aparezca, en vez de esconderlo detrás de un 500 genérico.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2023') {
    console.error('[ids] id malformado llegó a la base sin validar:', err.message);
    res.status(404).json({ error: 'No encontrado' });
    return;
  }

  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
}

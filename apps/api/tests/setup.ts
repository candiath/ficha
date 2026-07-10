import 'dotenv/config';

// Corre antes de que cada archivo de tests importe la app. NODE_ENV=test
// apaga el log de queries de Prisma y deja el CORS en modo desarrollo
// (la obligación de CORS_ORIGIN es solo de producción).
process.env.NODE_ENV = 'test';

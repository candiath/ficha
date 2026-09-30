import 'dotenv/config';

// Corre antes de que cada archivo de tests importe la app. NODE_ENV=test
// apaga el log de queries de Prisma y deja el CORS en modo desarrollo
// (la obligación de CORS_ORIGIN es solo de producción).
process.env.NODE_ENV = 'test';

// El secreto del operador de plataforma. En los tests no protege nada real
// —firma tokens que solo viven en este proceso—, así que si el entorno no
// trae uno se usa un valor fijo, con el mismo criterio que el cost 4 de
// bcrypt en helpers.ts. Solo acá: la app sigue exigiéndolo por env.
process.env.PLATFORM_JWT_SECRET ??= 'secreto-de-plataforma-solo-para-tests-0123456789';

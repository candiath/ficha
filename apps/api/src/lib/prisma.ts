import { PrismaClient } from '@prisma/client';

// Singleton: evita abrir múltiples conexiones en desarrollo con hot-reload.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Ping para el health check: la única query de la app que vive fuera de los
// repositorios, porque es infra pura (¿responde la DB?), no dominio.
export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

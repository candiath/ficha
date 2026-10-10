import { PrismaClient } from '@prisma/client';

// Singleton: evita abrir múltiples conexiones en desarrollo con hot-reload.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
    // Interactive transactions ($transaction(async (tx) => ...)) are closed by
    // Prisma after 5 s by default, and the commit then fails with P2028. Each
    // query inside one is a round-trip to Neon, so a multi-step write (a
    // session with its payment, episodes, appointment and audit row) crossed
    // 5 s from a CI runner with high latency. 10 s leaves room for that
    // without letting a stuck transaction hold its connection for long.
    // Applies to every interactive transaction, including those made through
    // forTenant(), which extends this client.
    transactionOptions: { timeout: 10_000 },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Ping para el health check: la única query de la app que vive fuera de los
// repositorios, porque es infra pura (¿responde la DB?), no dominio.
export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

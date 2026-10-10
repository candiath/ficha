import type { PrismaClient } from '@prisma/client';

// The seed writes known credentials (admin@ficha.dev / password123). NODE_ENV
// keeps it off the deployed services, but not off a laptop pointed at the
// wrong database. Every database the seed may run on holds only its own demo
// accounts and the tests' throwaway ones, so any other account means it is
// not one of them: the seed refuses instead of planting a back door (#186).
// Same idea as the reset guard in .github/workflows/test.yml.
export const SEED_ACCOUNT_DOMAINS = ['@ficha.dev', '@test.ficha.local'] as const;

function isSeedAccount(email: string): boolean {
  return SEED_ACCOUNT_DOMAINS.some((domain) => email.endsWith(domain));
}

// Emails of clinic users and platform operators outside those domains.
export async function foreignAccounts(db: PrismaClient): Promise<string[]> {
  const [users, operators] = await Promise.all([
    db.user.findMany({ select: { email: true } }),
    db.platformOperator.findMany({ select: { email: true } }),
  ]);
  return [...users, ...operators].map((a) => a.email).filter((email) => !isSeedAccount(email));
}

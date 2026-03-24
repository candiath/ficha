// Contexto temporal de desarrollo hasta implementar auth con JWT.
// Cuando se implemente auth, el middleware extrae estos valores del token
// y los adjunta a req (e.g. req.context = { tenantId, userId }).
//
// IMPORTANTE: estos IDs deben coincidir con los del seed (prisma/seed.ts).
export const DEV_CONTEXT = {
  tenantId: 'dev-tenant-001',
} as const;

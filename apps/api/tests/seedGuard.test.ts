import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { foreignAccounts } from '../prisma/seedGuard';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, TEST_PASSWORD, type TestClinic } from './helpers';

// The seed plants known credentials, so it refuses to run on a database with
// any account outside its own demo domain and the tests' (#186).
describe('seed guard', () => {
  let clinic: TestClinic;
  const foreign = `someone-${randomUUID().slice(0, 8)}@example.com`;

  beforeAll(async () => {
    clinic = await createTestClinic();
    await clinic.createUser();
    await prisma.user.create({
      data: { tenantId: clinic.tenantId, email: foreign, passwordHash: TEST_PASSWORD },
    });
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('reports an account outside the seed and test domains', async () => {
    expect(await foreignAccounts(prisma)).toContain(foreign);
  });

  it('ignores test accounts', async () => {
    const emails = await foreignAccounts(prisma);
    expect(emails.filter((e) => e.endsWith('@test.ficha.local'))).toEqual([]);
  });
});

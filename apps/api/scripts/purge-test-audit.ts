import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// Deletes the audit rows that interrupted test runs leave behind (#186,
// docs/specs/SPEC-audit-hardening.md §1 "Who deletes, and how"). Audit rows
// are append-only, so without this their clinics, patients and users could
// never be cleaned up either: every foreign key from an audit row restricts.
//
// Only rows of test clinics (exactly as tests/helpers.ts names them, every
// user under @test.ficha.local) created more than an hour ago, and platform
// rows of test operators older than an hour: a test run in progress keeps
// its rows. It needs the maintenance flag, so it refuses to run on staging or
// production.
//
// Also every sysadmin alert older than an hour, with its deliveries
// (SPEC-sysadmin-alerts.md §9): only development and ci carry the flag, and
// their alerts are all from tests or local runs.
//
// Usage: npm run purge:test-audit -w apps/api
// (against apps/api/.env's DATABASE_URL: development; for ci, set DATABASE_URL)

const prisma = new PrismaClient();

const TEST_DOMAIN = '%@test.ficha.local';
const AN_HOUR_MS = 60 * 60 * 1000;

async function main() {
  const [{ flagged }] = await prisma.$queryRaw<{ flagged: boolean }[]>`
    SELECT to_regclass('ficha_ops.audit_maintenance_allowed') IS NOT NULL AS flagged`;
  if (!flagged) {
    console.error(
      'This database has no audit maintenance flag: it is not development or ci. Nothing deleted.',
    );
    process.exit(1);
  }

  const { clinical, platform, clinics, alerts } = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('ficha.audit_maintenance', pg_current_xact_id()::text, true)`;
    const stale = await tx.$queryRaw<{ id: string }[]>`
      SELECT t.id FROM tenants t
      WHERE t.slug ~ '^test-[0-9a-f]{8}$'
        AND t.name = 'Clínica Test ' || substr(t.slug, 6)
        AND t.created_at < (now() AT TIME ZONE 'UTC') - interval '1 hour'
        AND NOT EXISTS (
          SELECT 1 FROM users u WHERE u.tenant_id = t.id AND u.email NOT LIKE ${TEST_DOMAIN}
        )`;
    const tenantIds = stale.map((t) => t.id);

    const clinicalRows = await tx.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    const platformRows = await tx.platformAuditLog.deleteMany({
      where: {
        OR: [
          { tenantId: { in: tenantIds } },
          {
            operator: { email: { endsWith: '@test.ficha.local' } },
            createdAt: { lt: new Date(Date.now() - AN_HOUR_MS) },
          },
        ],
      },
    });
    const anHourAgo = new Date(Date.now() - AN_HOUR_MS);
    await tx.sysadminAlertDelivery.deleteMany({ where: { alert: { createdAt: { lt: anHourAgo } } } });
    const alertRows = await tx.sysadminAlert.deleteMany({ where: { createdAt: { lt: anHourAgo } } });
    return {
      clinical: clinicalRows.count,
      platform: platformRows.count,
      clinics: tenantIds.length,
      alerts: alertRows.count,
    };
  });

  console.log(
    `Deleted ${clinical} clinical and ${platform} platform audit rows ` +
      `(${clinics} stale test clinics, and test operators), and ${alerts} sysadmin alerts.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

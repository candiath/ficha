-- Every timestamp column becomes timestamptz(3), before the relaunch (#238),
-- while no table holds real clinical rows. Decided on 2026-11-14.
--
-- Until now they were Prisma's default, timestamp(3) without time zone: a wall
-- time with no zone. It worked because Prisma always writes and reads UTC, but
-- raw SQL and any session whose TimeZone is not UTC read and write those
-- columns in their own zone (now() into one stores local time; a comparison
-- with a timestamptz casts the column in the session's zone). A timestamptz is
-- an instant: the session's zone only changes how it is printed.
--
-- * The instants do not change. Every value was written as UTC, so each column
--   is converted with USING ... AT TIME ZONE 'UTC'. Without USING, Postgres
--   would read the old values in the session's TimeZone.
-- * Precision stays at milliseconds, as Prisma writes them.
-- * The DEFAULT CURRENT_TIMESTAMP of the columns that have one is kept, and is
--   now stored as the instant it is instead of being cast to the session's
--   local time.
-- * The audit tables' created_at changes type too, so audit_rows_stamp_created_at
--   changes with it (below), with new expected values in prisma/audit-guards.sql
--   and an entry in tests/auditMigrationScan.test.ts. Six versioned tables change
--   type in place (tests/historyMigrationScan.test.ts): their content does not.
--
-- Changing a column's type changes the result type of every statement that
-- reads it, and the pooler's cached prepared statements then fail ("cached plan
-- must not change result type") until its server connections recycle. Here it
-- is every table: restart the Neon compute right after this runs, on each
-- environment (docs/infra.md, Política de migraciones).

-- Every table this migration alters, locked up front in one order, parents
-- before children and audit_logs before auth_sessions, which its session check
-- reads (as 20261010191055_audit_rows_enforced does, for the same reason):
-- otherwise a request of the code still serving could hold one table and wait
-- for another this migration already rewrote, a deadlock that could abort it.
-- Requests wait instead, for the moments the rewrites take.
LOCK TABLE public.tenants, public.platform_operators, public.users, public.password_reset_tokens,
  public.patients, public.clinical_episodes, public.patient_events, public.initial_evaluations,
  public.informed_consents, public.sessions, public.session_packages, public.payments,
  public.appointments, public.clinical_alerts, public.audit_logs, public.auth_sessions,
  public.platform_operator_sessions, public.platform_audit_logs, public.login_events,
  public.sysadmin_alerts, public.sysadmin_alert_deliveries IN ACCESS EXCLUSIVE MODE;

-- AlterTable
ALTER TABLE "tenants" ALTER COLUMN "alerts_refreshed_at" SET DATA TYPE TIMESTAMPTZ(3) USING "alerts_refreshed_at" AT TIME ZONE 'UTC',
ALTER COLUMN "deactivated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "deactivated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "last_login_at" SET DATA TYPE TIMESTAMPTZ(3) USING "last_login_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "auth_sessions" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ(3) USING "expires_at" AT TIME ZONE 'UTC',
ALTER COLUMN "revoked_at" SET DATA TYPE TIMESTAMPTZ(3) USING "revoked_at" AT TIME ZONE 'UTC',
ALTER COLUMN "last_used_at" SET DATA TYPE TIMESTAMPTZ(3) USING "last_used_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "password_reset_tokens" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ(3) USING "expires_at" AT TIME ZONE 'UTC',
ALTER COLUMN "used_at" SET DATA TYPE TIMESTAMPTZ(3) USING "used_at" AT TIME ZONE 'UTC',
ALTER COLUMN "invalidated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "invalidated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "platform_operators" ALTER COLUMN "last_login_at" SET DATA TYPE TIMESTAMPTZ(3) USING "last_login_at" AT TIME ZONE 'UTC',
ALTER COLUMN "password_changed_at" SET DATA TYPE TIMESTAMPTZ(3) USING "password_changed_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "platform_operator_sessions" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ(3) USING "expires_at" AT TIME ZONE 'UTC',
ALTER COLUMN "last_used_at" SET DATA TYPE TIMESTAMPTZ(3) USING "last_used_at" AT TIME ZONE 'UTC',
ALTER COLUMN "revoked_at" SET DATA TYPE TIMESTAMPTZ(3) USING "revoked_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "platform_audit_logs" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "sysadmin_alerts" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "sysadmin_alert_deliveries" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "login_events" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "patients" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMPTZ(3) USING "deleted_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "clinical_episodes" ALTER COLUMN "opened_at" SET DATA TYPE TIMESTAMPTZ(3) USING "opened_at" AT TIME ZONE 'UTC',
ALTER COLUMN "closed_at" SET DATA TYPE TIMESTAMPTZ(3) USING "closed_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "patient_events" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMPTZ(3) USING "deleted_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "initial_evaluations" ALTER COLUMN "evaluated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "evaluated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "sessions" ALTER COLUMN "session_date" SET DATA TYPE TIMESTAMPTZ(3) USING "session_date" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMPTZ(3) USING "deleted_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "session_packages" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "paid_at" SET DATA TYPE TIMESTAMPTZ(3) USING "paid_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "informed_consents" ALTER COLUMN "signed_at" SET DATA TYPE TIMESTAMPTZ(3) USING "signed_at" AT TIME ZONE 'UTC',
ALTER COLUMN "revoked_at" SET DATA TYPE TIMESTAMPTZ(3) USING "revoked_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "audit_logs" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "clinical_alerts" ALTER COLUMN "read_at" SET DATA TYPE TIMESTAMPTZ(3) USING "read_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "appointments" ALTER COLUMN "starts_at" SET DATA TYPE TIMESTAMPTZ(3) USING "starts_at" AT TIME ZONE 'UTC',
ALTER COLUMN "ends_at" SET DATA TYPE TIMESTAMPTZ(3) USING "ends_at" AT TIME ZONE 'UTC',
ALTER COLUMN "cancelled_at" SET DATA TYPE TIMESTAMPTZ(3) USING "cancelled_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- The row's time is the database's, and the insert's own (clock_timestamp, not
-- the transaction's start). It was clock_timestamp() AT TIME ZONE 'UTC', a UTC
-- wall time for a column without time zone; into a timestamptz that wall time
-- would be read in the session's TimeZone, off by its offset. The instant goes
-- in as it is.
CREATE OR REPLACE FUNCTION public.audit_rows_stamp_created_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT public.audit_maintenance_on() THEN
    NEW.created_at := clock_timestamp();
  END IF;
  RETURN NEW;
END
$$;

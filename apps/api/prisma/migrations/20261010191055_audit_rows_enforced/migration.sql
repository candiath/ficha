-- Audit rows hold what the database promises, not only what the application
-- happens to write (#186, docs/specs/SPEC-audit-hardening.md). Prisma does not
-- manage triggers or functions, so none of this causes drift; the checks in
-- prisma/audit-guards.sql pin every function and trigger by hash.
--
-- created_at keeps its millisecond precision on purpose. Changing a column's
-- type changes the result type of every statement that reads it, and the
-- pooler's cached prepared statements then fail ("cached plan must not change
-- result type") until its server connections recycle: every audited write,
-- during a deploy. Readers order by created_at, then id.

-- Maintenance (deleting audit rows, inserting them with a past date) needs two
-- things at once:
--  * the flag: the table ficha_ops.audit_maintenance_allowed exists. It lives
--    outside `public`, so Prisma neither sees it nor drops it on migrate reset.
--    Only the development and ci branches have it.
--  * the switch: ficha.audit_maintenance set, transaction-local, to the id of
--    the current transaction. A value that leaked (a session-level SET through
--    the pooler, another transaction's) never matches.
-- The switch is checked first, so ordinary writes never look up the flag.
-- Every name is schema-qualified and search_path ends in pg_temp: otherwise
-- pg_temp is searched first, and a TEMP table named like a real one would be
-- read instead of it.
CREATE FUNCTION public.audit_maintenance_on() RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF coalesce(current_setting('ficha.audit_maintenance', true), '')
     <> pg_current_xact_id()::text THEN
    RETURN false;
  END IF;
  RETURN to_regclass('ficha_ops.audit_maintenance_allowed') IS NOT NULL;
END
$$;

-- UPDATE and TRUNCATE: always rejected. DELETE: only under maintenance.
CREATE FUNCTION public.audit_rows_are_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' AND public.audit_maintenance_on() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit rows are append-only: % on % rejected', TG_OP, TG_TABLE_NAME;
END
$$;

-- The row's time is the database's, in UTC (the column is timestamp without
-- time zone, so now() would follow the session's TimeZone), and the insert's
-- own (clock_timestamp, not the transaction's start).
CREATE FUNCTION public.audit_rows_stamp_created_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT public.audit_maintenance_on() THEN
    NEW.created_at := clock_timestamp() AT TIME ZONE 'UTC';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER audit_logs_stamp_created_at BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_stamp_created_at();
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_are_append_only();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_rows_are_append_only();

CREATE TRIGGER platform_audit_logs_stamp_created_at BEFORE INSERT ON public.platform_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_stamp_created_at();
CREATE TRIGGER platform_audit_logs_append_only BEFORE UPDATE OR DELETE ON public.platform_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_are_append_only();
CREATE TRIGGER platform_audit_logs_no_truncate BEFORE TRUNCATE ON public.platform_audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_rows_are_append_only();

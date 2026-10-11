-- Fails (raises) when the guarantees on the audit tables differ from what the
-- migrations deployed (#186, docs/specs/SPEC-audit-hardening.md §1 "Checks").
-- Runs after `migrate deploy` in CI and on Render, and at API startup:
--   prisma db execute --file prisma/audit-guards.sql --schema prisma/schema.prisma
-- It sees only persistent changes: a change made and undone inside one
-- transaction by the owner role leaves nothing to find (#206).
--
-- Changing a trigger or one of these functions means a new migration (on the
-- DDL scan's allowlist) and new expected values here, in the same PR.
--
-- The audit tables are audit_logs, platform_audit_logs, and since
-- sysadmin-alerts (docs/specs/SPEC-sysadmin-alerts.md) sysadmin_alerts and
-- sysadmin_alert_deliveries.
DO $guards$
DECLARE
  -- The audit tables, resolved without erroring: a missing one is reported
  -- as a problem, not as a check that could not run. tests/auditHardening.test.ts
  -- swaps these literals for TEMP copies, so they appear nowhere else in this file.
  clinical regclass := to_regclass('public.audit_logs');
  platform regclass := to_regclass('public.platform_audit_logs');
  alerts regclass := to_regclass('public.sysadmin_alerts');
  deliveries regclass := to_regclass('public.sysadmin_alert_deliveries');

  problems text[] := '{}';
  tbl regclass;
  expected text;
  actual text;
  r record;
BEGIN
  IF clinical IS NULL THEN problems := problems || 'table audit_logs is missing'::text; END IF;
  IF platform IS NULL THEN problems := problems || 'table platform_audit_logs is missing'::text; END IF;
  IF alerts IS NULL THEN problems := problems || 'table sysadmin_alerts is missing'::text; END IF;
  IF deliveries IS NULL THEN problems := problems || 'table sysadmin_alert_deliveries is missing'::text; END IF;

  -- Triggers: exactly these, enabled. Each one is described by its name,
  -- timing/events/level (tgtype), the function it calls, its WHEN condition
  -- (hashed: pg_get_expr cannot print one that reads both NEW and OLD),
  -- its UPDATE OF columns, its arguments and whether it is a constraint
  -- trigger. Internal triggers (foreign keys) are checked below as constraints.
  FOR tbl, expected IN VALUES
    (clinical,
     'audit_logs_append_only 27 public.audit_rows_are_append_only() when=- cols= args=0 constraint=f' || E'\n' ||
     'audit_logs_check_session 7 public.audit_logs_check_session() when=- cols= args=0 constraint=f' || E'\n' ||
     'audit_logs_no_truncate 34 public.audit_rows_are_append_only() when=- cols= args=0 constraint=f' || E'\n' ||
     'audit_logs_stamp_created_at 7 public.audit_rows_stamp_created_at() when=- cols= args=0 constraint=f'),
    (platform,
     'platform_audit_logs_append_only 27 public.audit_rows_are_append_only() when=- cols= args=0 constraint=f' || E'\n' ||
     'platform_audit_logs_no_truncate 34 public.audit_rows_are_append_only() when=- cols= args=0 constraint=f' || E'\n' ||
     'platform_audit_logs_stamp_created_at 7 public.audit_rows_stamp_created_at() when=- cols= args=0 constraint=f'),
    (alerts,
     'sysadmin_alerts_append_only 27 public.audit_rows_are_append_only() when=- cols= args=0 constraint=f' || E'\n' ||
     'sysadmin_alerts_no_truncate 34 public.audit_rows_are_append_only() when=- cols= args=0 constraint=f' || E'\n' ||
     'sysadmin_alerts_stamp_created_at 7 public.audit_rows_stamp_created_at() when=- cols= args=0 constraint=f'),
    (deliveries,
     'sysadmin_alert_deliveries_append_only 27 public.audit_rows_are_append_only() when=- cols= args=0 constraint=f' || E'\n' ||
     'sysadmin_alert_deliveries_no_truncate 34 public.audit_rows_are_append_only() when=- cols= args=0 constraint=f' || E'\n' ||
     'sysadmin_alert_deliveries_stamp_created_at 7 public.audit_rows_stamp_created_at() when=- cols= args=0 constraint=f')
  LOOP
    -- A missing table is already reported above.
    CONTINUE WHEN tbl IS NULL;

    SELECT coalesce(string_agg(format('%s %s %s.%s(%s) when=%s cols=%s args=%s constraint=%s',
             t.tgname, t.tgtype, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
             coalesce(md5(t.tgqual::text), '-'), t.tgattr::text, t.tgnargs,
             t.tgconstraint <> 0), E'\n' ORDER BY t.tgname), '')
      INTO actual
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE t.tgrelid = tbl AND NOT t.tgisinternal;
    IF actual IS DISTINCT FROM expected THEN
      problems := problems || format('trigger set on %s differs: %s', tbl, actual);
    END IF;

    FOR r IN SELECT t.tgname FROM pg_catalog.pg_trigger t
              WHERE t.tgrelid = tbl AND NOT t.tgisinternal AND t.tgenabled <> 'O'
    LOOP
      problems := problems || format('trigger %s on %s is not enabled', r.tgname, tbl);
    END LOOP;

    -- No rule can rewrite a query on the table, no row-level security can
    -- hide rows from a reader, and the table is not UNLOGGED or TEMP.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite w WHERE w.ev_class = tbl) THEN
      problems := problems || format('table %s has a rule', tbl);
    END IF;
    IF (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = tbl) THEN
      problems := problems || format('table %s has row-level security', tbl);
    END IF;
    IF (SELECT c.relpersistence FROM pg_catalog.pg_class c WHERE c.oid = tbl) <> 'p' THEN
      problems := problems || format('table %s is not permanent', tbl);
    END IF;
    -- A child table (INHERITS, a partition) has none of these triggers or
    -- keys, and its rows show up in reads of the parent.
    IF (SELECT c.relhassubclass FROM pg_catalog.pg_class c WHERE c.oid = tbl) THEN
      problems := problems || format('table %s has child tables', tbl);
    END IF;

    -- Every foreign key from an audit table restricts, on delete and update.
    FOR r IN SELECT k.conname FROM pg_catalog.pg_constraint k
              WHERE k.conrelid = tbl AND k.contype = 'f'
                AND (k.confdeltype <> 'r' OR k.confupdtype <> 'r')
    LOOP
      problems := problems || format('foreign key %s on %s does not restrict', r.conname, tbl);
    END LOOP;
  END LOOP;

  -- The foreign keys themselves: name, columns on both sides, referenced
  -- table, MATCH SIMPLE and validated. The composite ones keep a row inside
  -- its clinic; one re-created under the same name on fewer columns would not.
  FOR r IN SELECT * FROM (VALUES
      (clinical, 'audit_logs_tenant_id_fkey', 'tenant_id', 'public.tenants'::regclass, 'id'),
      (clinical, 'audit_logs_tenant_id_patient_id_fkey', 'tenant_id,patient_id', 'public.patients'::regclass, 'tenant_id,id'),
      (clinical, 'audit_logs_tenant_id_user_id_fkey', 'tenant_id,user_id', 'public.users'::regclass, 'tenant_id,id'),
      (platform, 'platform_audit_logs_tenant_id_fkey', 'tenant_id', 'public.tenants'::regclass, 'id'),
      (platform, 'platform_audit_logs_operator_id_fkey', 'operator_id', 'public.platform_operators'::regclass, 'id'),
      (platform, 'platform_audit_logs_tenant_id_target_user_id_fkey', 'tenant_id,target_user_id', 'public.users'::regclass, 'tenant_id,id'),
      (alerts, 'sysadmin_alerts_operator_id_fkey', 'operator_id', 'public.platform_operators'::regclass, 'id'),
      (deliveries, 'sysadmin_alert_deliveries_alert_id_fkey', 'alert_id', alerts, 'id')
    ) AS fk(tbl, name, cols, target, target_cols)
  LOOP
    CONTINUE WHEN r.tbl IS NULL OR r.target IS NULL;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint k
       WHERE k.conrelid = r.tbl AND k.conname = r.name AND k.contype = 'f'
         AND k.confrelid = r.target AND k.confmatchtype = 's' AND k.convalidated
         AND (SELECT string_agg(a.attname, ',' ORDER BY c.n) FROM unnest(k.conkey) WITH ORDINALITY c(num, n)
                JOIN pg_catalog.pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = c.num) = r.cols
         AND (SELECT string_agg(a.attname, ',' ORDER BY c.n) FROM unnest(k.confkey) WITH ORDINALITY c(num, n)
                JOIN pg_catalog.pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = c.num) = r.target_cols
    ) THEN
      problems := problems || format('foreign key %s on %s is missing or changed', r.name, r.tbl);
    END IF;
  END LOOP;

  -- CHECK constraints, by name and exact definition (a Postgres upgrade that
  -- prints one differently fails here, and is then a reviewed PR). They tie
  -- a column to the kind of row that may carry it; a missing one would let a
  -- platform action drop out of its clinic's list, or a target escape the
  -- composite key (MATCH SIMPLE skips it when tenant_id is null).
  FOR r IN SELECT * FROM (VALUES
      (platform, 'platform_audit_logs_tenant_only_off_platform',
       $$CHECK (((tenant_id IS NULL) = ((action)::text = 'TEST_ALERT_SENT'::text)))$$),
      (platform, 'platform_audit_logs_target_needs_tenant',
       $$CHECK (((tenant_id IS NOT NULL) OR (target_user_id IS NULL)))$$),
      (alerts, 'sysadmin_alerts_operator_only_on_tests',
       $$CHECK (((kind = 'TEST'::"SysadminAlertKind") = (operator_id IS NOT NULL)))$$),
      (deliveries, 'sysadmin_alert_deliveries_error_code_on_rejected',
       $$CHECK (((outcome = 'REJECTED'::"SysadminAlertOutcome") = (error_code IS NOT NULL)))$$)
    ) AS c(tbl, name, def)
  LOOP
    CONTINUE WHEN r.tbl IS NULL;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint k
       WHERE k.conrelid = r.tbl AND k.conname = r.name AND k.contype = 'c'
         AND k.convalidated AND pg_get_constraintdef(k.oid) = r.def
    ) THEN
      problems := problems || format('check constraint %s on %s is missing or changed', r.name, r.tbl);
    END IF;
  END LOOP;

  -- Columns a CHECK or a key relies on: a CHECK with a null operand passes.
  FOR r IN SELECT * FROM (VALUES
      (platform, 'operator_id'),
      (alerts, 'kind'),
      (deliveries, 'alert_id'),
      (deliveries, 'outcome')
    ) AS c(tbl, col)
  LOOP
    CONTINUE WHEN r.tbl IS NULL;
    IF NOT coalesce((SELECT a.attnotnull FROM pg_catalog.pg_attribute a
                      WHERE a.attrelid = r.tbl AND a.attname = r.col), false) THEN
      problems := problems || format('%s.%s is nullable', r.tbl, r.col);
    END IF;
  END LOOP;

  -- Functions: body, SET clauses, volatility, SECURITY DEFINER and language,
  -- all part of pg_get_functiondef. \r is removed so a migration applied from a
  -- CRLF checkout hashes the same.
  FOR r IN SELECT * FROM (VALUES
      ('public.audit_maintenance_on()', '475ea0b36f23ed709a26e54aa89fc4f2'),
      ('public.audit_rows_are_append_only()', 'c35b0c6e4047a5b148f0750d2e2f2065'),
      ('public.audit_rows_stamp_created_at()', '0faed1c7656e41e1c747993b78b23af1'),
      ('public.audit_logs_check_session()', 'd6f9e9aa7014b9600e7c11f516f02af6')
    ) AS f(signature, hash)
  LOOP
    IF to_regprocedure(r.signature) IS NULL THEN
      problems := problems || format('function %s is missing', r.signature);
    ELSIF md5(replace(pg_get_functiondef(to_regprocedure(r.signature)), E'\r', '')) <> r.hash THEN
      problems := problems || format('function %s differs from the deployed one', r.signature);
    END IF;
  END LOOP;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'audit guards failed: %', array_to_string(problems, '; ');
  END IF;
END
$guards$;

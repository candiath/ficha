-- Every audit row names the database transaction that wrote it. An audited
-- write records its audit rows in its own transaction (#188), so the rows of
-- one write share the id: an encounter recorded from an appointment, with its
-- payment, writes ENCOUNTER_RECORDED, PAYMENT_CREATED and APPOINTMENT_UPDATED
-- with one transaction_id. It means "written in the same transaction", which
-- for an audited write is the same as "the same action"; two requests of one
-- flow (a clinic, then its ADMIN) are two transactions.
--
-- The database stamps it, as it stamps created_at: the trigger replaces
-- whatever the caller sends, except under audit maintenance (restoring rows,
-- backdated test fixtures), where a value sent is kept.
--
-- The value is md5(xid8 : the transaction's start in microseconds), shaped as
-- a version-8 UUID. Not the xid8 alone: after a dump is restored into another
-- cluster the counter starts over, and new transactions would repeat the ids
-- of old, unrelated ones. The start time tells them apart. It is not the xid
-- either, so it is never compared with pg_current_xact_id().
--
-- The column's default is the nil UUID, which the CHECK refuses: if the
-- trigger were ever missing, every insert would fail instead of writing rows
-- with no transaction. Rows written before this migration get a random id of
-- their own each (ADD COLUMN with that default rewrites the table without
-- firing any row trigger); production holds no real rows yet (#238).
--
-- The id is not returned to clinics: md5 of a small counter and a time close
-- to created_at can be brute-forced, and would tell how many transactions the
-- whole platform runs.

-- Both tables, locked up front in one order, as the earlier audit migrations do.
LOCK TABLE public.audit_logs, public.platform_audit_logs IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "audit_logs" ADD COLUMN "transaction_id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "audit_logs" ALTER COLUMN "transaction_id" SET DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_transaction_id_stamped"
  CHECK (transaction_id <> '00000000-0000-0000-0000-000000000000'::uuid);

ALTER TABLE "platform_audit_logs" ADD COLUMN "transaction_id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "platform_audit_logs" ALTER COLUMN "transaction_id" SET DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_transaction_id_stamped"
  CHECK (transaction_id <> '00000000-0000-0000-0000-000000000000'::uuid);

-- pg_current_xact_id() is the top-level transaction's, also inside a
-- savepoint. Bytes 6 and 8 get the version (8) and the variant (10xx) bits.
CREATE FUNCTION public.audit_rows_stamp_transaction_id() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  h bytea;
BEGIN
  IF coalesce(NEW.transaction_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = '00000000-0000-0000-0000-000000000000'::uuid
     OR NOT public.audit_maintenance_on() THEN
    h := decode(md5(pg_current_xact_id()::text || ':' ||
                    (extract(epoch FROM transaction_timestamp()) * 1000000)::bigint::text), 'hex');
    h := set_byte(h, 6, (get_byte(h, 6) & 15) | 128);
    h := set_byte(h, 8, (get_byte(h, 8) & 63) | 128);
    NEW.transaction_id := encode(h, 'hex')::uuid;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER audit_logs_stamp_transaction_id BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_stamp_transaction_id();
CREATE TRIGGER platform_audit_logs_stamp_transaction_id BEFORE INSERT ON public.platform_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_stamp_transaction_id();

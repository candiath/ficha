-- A patient's name in two columns, given names and surnames (#238): the clinic
-- finds and sorts patients by surname. Splitting one string later is guesswork
-- (two surnames, compound given names), so it goes in before real records.
--
-- The rows there are test data or the clinic's trial, wiped before the
-- relaunch: the last word becomes the surname, and a one-word name keeps it as
-- the given name with a placeholder surname.
ALTER TABLE "patients"
  ADD COLUMN "first_name" TEXT,
  ADD COLUMN "last_name" TEXT;

UPDATE "patients" SET
  "first_name" = CASE WHEN btrim("full_name") ~ '\s'
    THEN regexp_replace(btrim("full_name"), '\s+\S+$', '')
    ELSE btrim("full_name") END,
  "last_name" = CASE WHEN btrim("full_name") ~ '\s'
    THEN substring(btrim("full_name") from '\S+$')
    ELSE 'Sin apellido' END;

ALTER TABLE "patients"
  ALTER COLUMN "first_name" SET NOT NULL,
  ALTER COLUMN "last_name" SET NOT NULL,
  DROP COLUMN "full_name",
  -- The API trims and requires both (requiredText); this keeps a write path
  -- that forgets from storing an empty one.
  ADD CONSTRAINT "patients_first_name_present" CHECK (btrim("first_name") <> ''),
  ADD CONSTRAINT "patients_last_name_present" CHECK (btrim("last_name") <> '');

-- The clinic's patient list, by surname.
CREATE INDEX "patients_tenant_id_last_name_first_name_idx" ON "patients"("tenant_id", "last_name", "first_name");

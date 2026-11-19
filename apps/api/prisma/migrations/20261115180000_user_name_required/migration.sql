-- A user's name is required: every clinical entry is signed by a user, and an
-- entry signed by an email alone is useless to whoever reads the record.
--
-- No backfill on purpose. A row with no name, or a blank one, makes this
-- migration fail, and whoever runs it decides what that person is called:
-- inventing a name would put a made-up signature on the record. No deployed
-- database holds clinic users with real data yet.
ALTER TABLE "users"
  ALTER COLUMN "name" SET NOT NULL,
  -- The API trims and requires it (requiredText); this keeps a write path
  -- that forgets from storing an empty one.
  ADD CONSTRAINT "users_name_present" CHECK (btrim("name") <> '');

-- informed_consents.signed repeated the dates: it allowed signed = false with
-- a signed_at and no revoked_at. A consent row exists once the patient signed,
-- so signed_at is NOT NULL, and "signed" is derived from the dates (signed and
-- not revoked) in the DTO. Staging and production hold no consent row.
ALTER TABLE "informed_consents"
  DROP COLUMN "signed",
  ALTER COLUMN "signed_at" SET NOT NULL,
  ADD CONSTRAINT "informed_consents_revoked_after_signed" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "signed_at");

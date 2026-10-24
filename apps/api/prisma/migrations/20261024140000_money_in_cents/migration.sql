-- Money in integer cents (#238): exact arithmetic, in the database and in the
-- API. The columns were already exact (NUMERIC(10,2)), but the API added and
-- subtracted them as floating point numbers, and accepted any number of
-- decimals. BIGINT and not INTEGER: INTEGER stops at $21.474.836,47.
--
-- Copy, then drop, in one release: production holds only the clinic's trial
-- and is wiped before the relaunch, so no deployed code reads the old columns
-- once this one is out. The CHECKs of 20261024120000_model_integrity on the old
-- columns go with them.

ALTER TABLE "payments"
  ADD COLUMN "base_amount_cents" BIGINT,
  ADD COLUMN "discount_cents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "final_amount_cents" BIGINT;

UPDATE "payments" SET
  "base_amount_cents" = round("base_amount" * 100)::BIGINT,
  "discount_cents" = round("discount" * 100)::BIGINT,
  "final_amount_cents" = round("base_amount" * 100)::BIGINT - round("discount" * 100)::BIGINT;

ALTER TABLE "payments"
  ALTER COLUMN "base_amount_cents" SET NOT NULL,
  ALTER COLUMN "final_amount_cents" SET NOT NULL,
  DROP COLUMN "base_amount",
  DROP COLUMN "discount",
  DROP COLUMN "final_amount";

ALTER TABLE "session_packages" ADD COLUMN "price_per_session_cents" BIGINT;
UPDATE "session_packages" SET "price_per_session_cents" = round("price_per_session" * 100)::BIGINT;
ALTER TABLE "session_packages"
  ALTER COLUMN "price_per_session_cents" SET NOT NULL,
  DROP COLUMN "price_per_session";

-- With exact arithmetic, the final amount can be pinned to the other two.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amounts_not_negative" CHECK ("base_amount_cents" >= 0 AND "discount_cents" >= 0),
  ADD CONSTRAINT "payments_discount_within_base" CHECK ("discount_cents" <= "base_amount_cents"),
  ADD CONSTRAINT "payments_final_is_base_minus_discount" CHECK ("final_amount_cents" = "base_amount_cents" - "discount_cents");

ALTER TABLE "session_packages"
  ADD CONSTRAINT "session_packages_price_positive" CHECK ("price_per_session_cents" > 0);

-- How and when the money came in exist exactly while a payment is PAID.
-- Turning a PAID payment back to PENDING used to keep its paid_at, and a PAID
-- payment could have no method or no date. The repository now settles both
-- against the status the payment ends in; these CHECKs make it the database's
-- rule too. Staging and production held no row against them.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_paid_has_date" CHECK (("status" = 'PAID') = ("paid_at" IS NOT NULL)),
  ADD CONSTRAINT "payments_paid_has_method" CHECK (("status" = 'PAID') = ("method" IS NOT NULL));

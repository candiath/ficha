-- An episode closes on or after its opening (#280). Every path that closes one
-- already refuses a closing before the opening: a PATCH of the episode, and a
-- discharge, which closes it on the discharge's own date (#278). The rule now
-- lives in the database too. `20261024120000_model_integrity` left it out
-- because a discharge closed at the current time, and that reason is gone.
-- An episode with no closing date passes: NULL >= x is not false.
ALTER TABLE "clinical_episodes"
  ADD CONSTRAINT "clinical_episodes_closed_after_opened" CHECK ("closed_at" >= "opened_at");

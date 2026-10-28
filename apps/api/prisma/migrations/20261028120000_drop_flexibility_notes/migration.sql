-- The client dropped the flexibility / shortening test from the initial
-- evaluation (#238).
--
-- One release, like 20261015120000_drop_foot_evaluation: nobody uses the app
-- until the relaunch, and the values dropped are test data (production is
-- wiped before the relaunch). The code still serving during the Render build
-- reads the dropped column, so its evaluation routes fail until the new deploy
-- is live.

-- AlterTable
ALTER TABLE "initial_evaluations" DROP COLUMN "flexibility_notes";

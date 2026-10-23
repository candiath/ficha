-- The client dropped the foot evaluation from the initial evaluation (#238).
--
-- One release, like 20261014140000_initial_evaluation_without_rpg: nobody uses
-- the app until the relaunch, and the values dropped are test data (production
-- is wiped before the relaunch). The code still serving during the Render build
-- reads the dropped column, so its evaluation routes fail until the new deploy
-- is live.

-- AlterTable
ALTER TABLE "initial_evaluations" DROP COLUMN "foot_evaluation";

-- How the patient arrived ("Evaluación (estado pre-sesión)") and the treatment
-- ("Tratamiento", stored as the session's observations) move from the session
-- to each episode's block (#238): the treatment of a foot has nothing to do
-- with the treatment of a hand. The session keeps observations only as the
-- text of a note, which may belong to no episode.
--
-- Written by hand, to move the values instead of dropping them. A session's
-- text goes to every block it has (until #243 a session had at most one). A
-- note keeps its text. A session without blocks has nowhere to put its
-- pre-session state and loses it: only test data has such sessions (production
-- is wiped before the relaunch).
--
-- One release, like #243: nobody uses the app until the relaunch. The code
-- still serving during the Render build reads the dropped column, so its
-- session routes fail until the new deploy is live.

-- 1. The block gets the two fields, filled from its session.
-- AlterTable
ALTER TABLE "session_episodes" ADD COLUMN     "pre_session_state" TEXT,
ADD COLUMN     "treatment" TEXT;

UPDATE "session_episodes" AS se
SET "pre_session_state" = s."pre_session_state",
    "treatment" = CASE WHEN s."session_type" <> 'NOTE' THEN s."observations" END
FROM "sessions" AS s
WHERE s."id" = se."session_id";

-- 2. A session or discharge whose treatment moved to its blocks no longer
-- holds it.
UPDATE "sessions" AS s
SET "observations" = NULL
WHERE s."session_type" <> 'NOTE'
  AND EXISTS (SELECT 1 FROM "session_episodes" AS se WHERE se."session_id" = s."id");

-- 3. The session keeps no pre-session state.
-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "pre_session_state";

-- The initial evaluation is for conventional physiotherapy (#238). RPG is a
-- specialty of the therapist, and its fields leave the evaluation: global
-- posture, morphotype, breathing pattern and its detail, family pain, posture
-- families. "Momento de aparición del dolor" leaves too: the pain's onset is a
-- dated fact of the patient's history now, not free text that ages.
--
-- Two fields are renamed to what they hold, written by hand with RENAME so the
-- values stay (Prisma would generate DROP + ADD): the evaluation's "Motivo de
-- consulta" is the patient's account, and "Historia clínica" holds what the
-- history list does not.
--
-- One release, like #243: nobody uses the app until the relaunch, and the
-- values dropped are test data (production is wiped before the relaunch). The
-- code still serving during the Render build reads the dropped columns, so its
-- evaluation routes fail until the new deploy is live.

-- AlterTable
ALTER TABLE "initial_evaluations" RENAME COLUMN "reason_for_consultation" TO "patient_narrative";

-- AlterTable
ALTER TABLE "initial_evaluations" RENAME COLUMN "medical_history" TO "other_history";

-- AlterTable
ALTER TABLE "initial_evaluations" DROP COLUMN "breathing_pattern",
DROP COLUMN "breathing_pattern_detail",
DROP COLUMN "family_pain_appearance",
DROP COLUMN "family_pain_disappearance",
DROP COLUMN "global_posture",
DROP COLUMN "morphotype",
DROP COLUMN "pain_appearance_moment",
DROP COLUMN "posture_families";

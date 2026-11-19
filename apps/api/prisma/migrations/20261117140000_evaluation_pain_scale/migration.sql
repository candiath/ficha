-- initial_evaluations.eva_scale becomes pain_scale, the name of the field in the
-- API, the snapshot and the audit field list (the label users read stays "Escala
-- EVA"). Done before the relaunch because the name of a versioned field, once a
-- snapshot holds it, is permanent. A rename, not a drop and an add: the values
-- stay. Its CHECK (0 to 10, from 20261024120000_model_integrity) follows it.

-- AlterTable
ALTER TABLE "initial_evaluations" RENAME COLUMN "eva_scale" TO "pain_scale";

-- AlterTable
ALTER TABLE "initial_evaluations" RENAME CONSTRAINT "initial_evaluations_eva_range" TO "initial_evaluations_pain_range";

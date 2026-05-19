-- AlterTable
ALTER TABLE "initial_evaluations" ADD COLUMN     "breathing_pattern_detail" TEXT,
ADD COLUMN     "flexibility_notes" TEXT,
ADD COLUMN     "foot_evaluation" TEXT,
ADD COLUMN     "morphotype" TEXT,
ADD COLUMN     "retraction_map" JSONB;

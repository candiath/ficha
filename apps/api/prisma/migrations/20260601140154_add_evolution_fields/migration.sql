-- AlterTable
ALTER TABLE "initial_evaluations" ADD COLUMN     "eva_scale" INTEGER,
ADD COLUMN     "family_pain_appearance" JSONB,
ADD COLUMN     "family_pain_disappearance" JSONB,
ADD COLUMN     "pain_appearance_moment" TEXT,
ADD COLUMN     "physical_activity" TEXT;

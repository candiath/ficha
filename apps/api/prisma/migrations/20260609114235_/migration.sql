/*
  Warnings:

  - You are about to drop the column `occupation` on the `initial_evaluations` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "clinical_episodes" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "initial_evaluations" DROP COLUMN "occupation";

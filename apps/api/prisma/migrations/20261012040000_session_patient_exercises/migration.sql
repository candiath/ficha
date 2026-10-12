-- The session field labelled "Respuesta del paciente" always held the exercises
-- the patient is to do; its label was wrong. The column takes the field's name.
--
-- Written by hand: for a rename Prisma generates DROP COLUMN + ADD COLUMN,
-- which would erase the values. RENAME keeps them.
--
-- The code still serving during the build reads "patient_response": from this
-- statement until the new deploy is live, its session routes fail. Release it
-- when nobody is using the app.

-- AlterTable
ALTER TABLE "sessions" RENAME COLUMN "patient_response" TO "patient_exercises";

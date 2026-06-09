-- Remove the old unique constraint on patient_id in initial_evaluations.
-- The schema no longer declares patientId as @unique (a patient can have
-- multiple evaluations across different clinical episodes), but the pre-episode
-- migration did not drop this index.
DROP INDEX IF EXISTS "initial_evaluations_patient_id_key";

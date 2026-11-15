-- Two columns nothing reads or writes, dropped in the same release that stopped
-- using them (and not two releases later, as a destructive migration usually
-- is) because staging holds no data and production holds only the platform
-- operator's account (decided 2026-11-15, before the relaunch).
--
-- 1. initial_evaluations.retraction_map: the evaluation's body map, removed from
--    the model before the relaunch (#238); its shape was never defined.
-- 2. platform_operators.password_changed_at: neither read nor written since
--    operator sessions (a password change revokes sessions instead).
--
-- initial_evaluations is a versioned table: tests/historyMigrationScan.test.ts
-- lists this DROP, with the reason, as the one exception.

-- AlterTable
ALTER TABLE "initial_evaluations" DROP COLUMN "retraction_map";

-- AlterTable
ALTER TABLE "platform_operators" DROP COLUMN "password_changed_at";

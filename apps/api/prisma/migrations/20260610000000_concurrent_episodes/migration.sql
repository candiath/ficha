-- ─────────────────────────────────────────────────────────────────────────────
-- Sesiones ↔ episodios pasa a M:N: una misma sesión puede abordar varios motivos
-- de consulta a la vez (p. ej. cervicalgia y lumbalgia en la misma visita).
-- Además se elimina TreatmentCycle (plan no utilizado; el seguimiento se hace a
-- nivel de episodio y los paquetes prepagos siguen en session_packages).
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable: pivote sesión ↔ episodio
CREATE TABLE "session_episodes" (
    "session_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,

    CONSTRAINT "session_episodes_pkey" PRIMARY KEY ("session_id","episode_id")
);

-- CreateIndex
CREATE INDEX "session_episodes_episode_id_idx" ON "session_episodes"("episode_id");

-- Backfill: migrar el episode_id actual de cada sesión al pivote
INSERT INTO "session_episodes" ("session_id", "episode_id")
SELECT "id", "episode_id"
FROM   "sessions"
WHERE  "episode_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "session_episodes" ADD CONSTRAINT "session_episodes_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_episodes" ADD CONSTRAINT "session_episodes_episode_id_fkey"
    FOREIGN KEY ("episode_id") REFERENCES "clinical_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropColumn sessions.episode_id (reemplazado por el pivote)
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_episode_id_fkey";
DROP INDEX "sessions_episode_id_idx";
ALTER TABLE "sessions" DROP COLUMN "episode_id";

-- DropTable treatment_cycles + enum (al eliminar la tabla se borran sus FKs)
DROP TABLE "treatment_cycles";
DROP TYPE "CycleStatus";

-- AlterTable
ALTER TABLE "session_techniques" ADD COLUMN     "muscular_chain_id" TEXT;

-- CreateTable
CREATE TABLE "muscular_chains" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "muscular_chains_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "session_techniques" ADD CONSTRAINT "session_techniques_muscular_chain_id_fkey" FOREIGN KEY ("muscular_chain_id") REFERENCES "muscular_chains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

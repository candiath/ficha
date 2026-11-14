-- CreateTable
CREATE TABLE "platform_operator_sessions" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "platform_operator_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_operator_sessions_token_hash_key" ON "platform_operator_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "platform_operator_sessions_operator_id_idx" ON "platform_operator_sessions"("operator_id");

-- AddForeignKey
ALTER TABLE "platform_operator_sessions" ADD CONSTRAINT "platform_operator_sessions_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "platform_operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;


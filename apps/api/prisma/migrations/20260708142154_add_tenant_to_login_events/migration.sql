-- AlterTable
ALTER TABLE "login_events" ADD COLUMN     "tenant_id" TEXT;

-- CreateIndex
CREATE INDEX "login_events_tenant_id_idx" ON "login_events"("tenant_id");

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

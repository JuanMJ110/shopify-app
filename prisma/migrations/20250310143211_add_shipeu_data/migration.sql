-- AlterTable
ALTER TABLE "Session" ADD COLUMN "lastSync" DATETIME;
ALTER TABLE "Session" ADD COLUMN "shipeuEmail" TEXT;
ALTER TABLE "Session" ADD COLUMN "shipeuError" TEXT;
ALTER TABLE "Session" ADD COLUMN "shipeuStoreId" TEXT;

-- CreateIndex
CREATE INDEX "Session_shipeuStatus_idx" ON "Session"("shipeuStatus");

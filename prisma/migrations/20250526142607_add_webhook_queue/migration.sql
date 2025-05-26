-- CreateTable
CREATE TABLE "WebhookQueue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "WebhookQueue_shop_idx" ON "WebhookQueue"("shop");

-- CreateIndex
CREATE INDEX "WebhookQueue_status_idx" ON "WebhookQueue"("status");

-- CreateIndex
CREATE INDEX "WebhookQueue_createdAt_idx" ON "WebhookQueue"("createdAt");

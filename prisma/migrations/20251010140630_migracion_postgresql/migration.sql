-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "apiKey" TEXT,
    "shipeuStatus" TEXT DEFAULT 'pending',
    "shipeuId" TEXT,
    "lastSync" TIMESTAMP(3),
    "shipeuLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookQueue" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_shop_key" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Session_apiKey_key" ON "Session"("apiKey");

-- CreateIndex
CREATE INDEX "Session_shipeuStatus_idx" ON "Session"("shipeuStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Session_shop_apiKey_key" ON "Session"("shop", "apiKey");

-- CreateIndex
CREATE INDEX "WebhookQueue_shop_idx" ON "WebhookQueue"("shop");

-- CreateIndex
CREATE INDEX "WebhookQueue_status_idx" ON "WebhookQueue"("status");

-- CreateIndex
CREATE INDEX "WebhookQueue_createdAt_idx" ON "WebhookQueue"("createdAt");

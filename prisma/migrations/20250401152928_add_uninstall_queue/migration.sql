-- CreateTable
CREATE TABLE "UninstallQueue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "UninstallQueue_shop_key" ON "UninstallQueue"("shop");

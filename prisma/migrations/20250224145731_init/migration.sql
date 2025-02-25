/*
  Warnings:

  - A unique constraint covering the columns `[shop,apiKey]` on the table `Session` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Session" ADD COLUMN "apiKey" TEXT;
ALTER TABLE "Session" ADD COLUMN "apiKeyExpires" DATETIME;

-- CreateIndex
CREATE UNIQUE INDEX "Session_shop_apiKey_key" ON "Session"("shop", "apiKey");

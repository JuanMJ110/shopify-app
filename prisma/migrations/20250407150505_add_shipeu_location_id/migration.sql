-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
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
    "lastSync" DATETIME,
    "shipeuLocationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Session" ("accessToken", "accountOwner", "apiKey", "collaborator", "createdAt", "email", "emailVerified", "expires", "firstName", "id", "isOnline", "lastName", "lastSync", "locale", "scope", "shipeuId", "shipeuStatus", "shop", "state", "updatedAt", "userId") SELECT "accessToken", "accountOwner", "apiKey", "collaborator", "createdAt", "email", "emailVerified", "expires", "firstName", "id", "isOnline", "lastName", "lastSync", "locale", "scope", "shipeuId", "shipeuStatus", "shop", "state", "updatedAt", "userId" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE UNIQUE INDEX "Session_shop_key" ON "Session"("shop");
CREATE UNIQUE INDEX "Session_apiKey_key" ON "Session"("apiKey");
CREATE INDEX "Session_shipeuStatus_idx" ON "Session"("shipeuStatus");
CREATE UNIQUE INDEX "Session_shop_apiKey_key" ON "Session"("shop", "apiKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

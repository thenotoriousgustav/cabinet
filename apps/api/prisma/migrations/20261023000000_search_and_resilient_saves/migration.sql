-- Additive: existing notes, drawings and links are unchanged.
CREATE TABLE "saved_searches" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "url" VARCHAR(2000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "saved_searches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "saved_searches_userId_idx" ON "saved_searches"("userId");
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER TABLE "bookmarks" ADD COLUMN "noteRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "noteSaveId" UUID,
  ADD COLUMN "clientRequestId" UUID;
CREATE UNIQUE INDEX "bookmarks_userId_clientRequestId_key" ON "bookmarks"("userId", "clientRequestId");
CREATE INDEX "bookmarks_title_trgm_idx" ON "bookmarks" USING gin (lower("title") gin_trgm_ops);
CREATE INDEX "bookmarks_userId_createdAt_idx" ON "bookmarks" ("userId", "createdAt");

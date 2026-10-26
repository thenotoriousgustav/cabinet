-- Existing titles are treated as user-owned; only new URL placeholders may be replaced.
ALTER TABLE "bookmarks" ADD COLUMN "metadataTitlePending" BOOLEAN NOT NULL DEFAULT false;

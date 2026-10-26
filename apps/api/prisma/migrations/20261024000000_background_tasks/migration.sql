ALTER TABLE "users" ADD COLUMN "onboardingDismissed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "extensionLastSeenAt" TIMESTAMP(3);
ALTER TABLE "bookmarks" ADD COLUMN "source" VARCHAR(16) NOT NULL DEFAULT 'WEB';
CREATE TABLE "background_tasks" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "kind" VARCHAR(24) NOT NULL,
  "activeKey" VARCHAR(80),
  "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  "payload" JSONB,
  "total" INTEGER NOT NULL DEFAULT 0,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "error" VARCHAR(300),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "background_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "background_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "background_tasks_activeKey_key" ON "background_tasks"("activeKey");
CREATE INDEX "background_tasks_userId_createdAt_idx" ON "background_tasks"("userId", "createdAt" DESC);
CREATE INDEX "background_tasks_status_createdAt_idx" ON "background_tasks"("status", "createdAt");

// Build first. Exercises retries/edits in an isolated, automatically migrated PostgreSQL database.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { isolatedDatabase } from "./isolated-database.mjs"
const require = createRequire(import.meta.url)
const { PrismaClient } = require("@prisma/client")
const { PrismaPg } = require("@prisma/adapter-pg")
const { Queue } = require("bullmq")
const { BookmarksService } = require("../dist/modules/cabinet/bookmarks/bookmarks.service.js")
const { BackgroundTasksService } = require("../dist/modules/cabinet/services/background-tasks.service.js")
const { MetadataQueueService } = require("../dist/modules/cabinet/services/metadata-queue.service.js")
const { BackgroundTaskProcessor } = require("../dist/modules/cabinet/workers/background-task.processor.js")
const { EnrichmentProcessor } = require("../dist/modules/cabinet/workers/enrichment.processor.js")
if (!process.env.DATABASE_URL || process.env.NODE_ENV === "production") throw new Error("Use a development database")
const database = await isolatedDatabase("retry")
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: database.url }) })
const userId = randomUUID(), outsider = randomUUID(), prefix = `retry-${randomUUID()}`
const queue = new Queue("bookmark-enrichment", { prefix, connection: { host: process.env.REDIS_HOST || "127.0.0.1", port: Number(process.env.REDIS_PORT || 6379) } })
try {
  await prisma.user.createMany({ data: [userId, outsider].map((id) => ({ id, email: `retry-${id}@example.test`, name: "Retry integration" })) })
  const tasks = new BackgroundTasksService(prisma, { getJob: async () => null, add: async () => {} })
  const bookmarks = new BookmarksService(prisma, {}, { isVideoUrl: () => false }, { enqueue: async () => true }, tasks)
  const html = `<DL><H3>Parent</H3><DL><A HREF="https://example.test/one">One</A><H3>Child</H3><DL><A HREF="https://example.test/two">Two</A></DL></DL></DL>`
  const task = await bookmarks.importBookmarks(userId, html)
  const save = bookmarks.create.bind(bookmarks)
  let calls = 0
  bookmarks.create = async (...args) => { if (++calls === 2) throw new Error("Private database error must not reach the activity response"); return save(...args) }
  const processor = new BackgroundTaskProcessor(prisma, bookmarks, {})
  const job = { id: "test", data: { taskId: task.id }, attemptsMade: 0, opts: { attempts: 1 } }
  await assert.rejects(() => processor.process(job))
  const failed = await prisma.backgroundTask.findUnique({ where: { id: task.id } })
  assert.equal(failed.status, "FAILED")
  assert.equal(failed.processed, 1)
  assert.equal(await prisma.bookmark.count({ where: { userId } }), 1)
  assert.doesNotMatch(JSON.stringify(await tasks.list(userId)), /Private database error|<DL>|htmlContent/)
  await assert.rejects(() => tasks.retry(outsider, task.id), /Task not found/)
  await tasks.retry(userId, task.id)
  bookmarks.create = save
  await processor.process(job)
  const complete = await prisma.backgroundTask.findUnique({ where: { id: task.id } })
  assert.equal(complete.status, "COMPLETED")
  assert.equal(complete.processed, 2)
  assert.equal(complete.attempt, 2)
  assert.equal(complete.payload, null)
  assert.equal(await prisma.bookmark.count({ where: { userId } }), 2)
  assert.equal(await prisma.folder.count({ where: { userId } }), 2)
  const nested = await prisma.bookmark.findFirst({ where: { userId, title: "Two" }, include: { folder: { include: { parent: true } } } })
  assert.equal(nested.folder.name, "Child")
  assert.equal(nested.folder.parent.name, "Parent")

  const row = await bookmarks.create(userId, { url: "https://react.dev/learn" })
  const metadataQueue = new MetadataQueueService(prisma, queue)
  await Promise.all([metadataQueue.enqueue(row), metadataQueue.enqueue(row)])
  assert.equal(await queue.getWaitingCount(), 1)
  let finishFetch, fetched
  const started = new Promise((resolve) => { fetched = resolve })
  const metadata = new EnrichmentProcessor(prisma, { extract: async () => { fetched(); return new Promise((resolve) => { finishFetch = resolve }) } })
  const inFlight = metadata.process({ id: "metadata", data: { bookmarkId: row.id, url: row.url }, attemptsMade: 0, opts: { attempts: 1 } })
  await started
  await bookmarks.update(userId, row.id, { title: "My title while fetching", description: "My description while fetching" })
  finishFetch({ title: "Website title", description: "Website description", imageUrl: "https://react.dev/cover.png" })
  await inFlight
  const saved = await prisma.bookmark.findUnique({ where: { id: row.id } })
  assert.equal(saved.title, "My title while fetching")
  assert.equal(saved.description, "My description while fetching")
  assert.equal(saved.imageUrl, "https://react.dev/cover.png")
  assert.equal(saved.metadataStatus, "COMPLETED")
  let networkCalls = 0
  await new EnrichmentProcessor(prisma, { extract: async () => { networkCalls++; return {} } }).process({ id: "duplicate", data: { bookmarkId: row.id, url: row.url } })
  assert.equal(networkCalls, 0)
  await prisma.backgroundTask.createMany({ data: Array.from({ length: 33 }, () => ({ userId, kind: "LINK_CHECK", status: "FAILED" })) })
  await prisma.bookmark.createMany({ data: Array.from({ length: 31 }, (_, index) => ({ userId, title: `Pending fixture ${index}`, url: `https://retry-pagination.invalid/${index}`, metadataStatus: "PENDING" })) })
  const firstPage = await tasks.list(userId, 1), secondPage = await tasks.list(userId, 2)
  assert.equal(firstPage.tasks.length, 30)
  assert.equal(secondPage.tasks.length, 4)
  assert.equal(firstPage.hasMore, true)
  assert.ok(firstPage.tasks.every((task) => !secondPage.tasks.some((other) => other.id === task.id)))
  assert.equal(secondPage.metadata.length, 3)
  assert.equal((await tasks.list(outsider, 2)).tasks.length, 0)
  await assert.rejects(() => tasks.list(userId, 0), /Page must/)
  console.log("PASS paginated account-scoped history; partial import retry without duplicate links/folders, nested hierarchy, private payload/error handling, retry ownership, real BullMQ job deduplication and preservation of edits during enrichment")
} finally {
  try {
    try { await queue.obliterate({ force: true }) } finally { await queue.close() }
  } finally {
    try { await prisma.$disconnect() } finally { await database.cleanup() }
  }
}

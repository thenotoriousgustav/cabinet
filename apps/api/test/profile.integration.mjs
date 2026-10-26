// Build first. Creates/migrates an isolated test database and Redis namespace.
// node --env-file=.env test/profile.integration.mjs [report.json]
import assert from "node:assert/strict"
import { randomUUID, createHmac } from "node:crypto"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createRequire } from "node:module"
import { writeFile } from "node:fs/promises"
import { isolatedDatabase } from "./isolated-database.mjs"
const require = createRequire(import.meta.url)
const { PrismaClient } = require("@prisma/client")
const { PrismaPg } = require("@prisma/adapter-pg")
const { Queue } = require("bullmq")
if (!process.env.DATABASE_URL || process.env.NODE_ENV === "production") throw new Error("Run against a development database only")
const database = await isolatedDatabase("profile")
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: database.url }) })
const users = [randomUUID(), randomUUID()]
const secret = `${randomUUID()}${randomUUID()}`, origin = "http://localhost:3000", apiUrl = "http://localhost:4243", prefix = `profile-${randomUUID()}`
let logs = ""
const api = spawn(process.execPath, ["dist/main.js"], { env: { ...process.env, PORT: "4243", DATABASE_URL: database.url, API_URL: apiUrl, FRONTEND_URL: origin, NODE_ENV: "test", BETTER_AUTH_SECRET: secret, OPERATIONS_USER_IDS: users[0], BULLMQ_PREFIX: prefix }, stdio: ["ignore", "pipe", "pipe"] })
api.stdout.on("data", (chunk) => { logs = (logs + chunk).slice(-20000) })
api.stderr.on("data", (chunk) => { logs = (logs + chunk).slice(-20000) })
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const json = async (path, cookie, body, method = body ? "POST" : "GET") => {
  const response = await fetch(`${apiUrl}${path}`, { method, headers: { Origin: origin, Cookie: cookie || "", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) })
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`)
  return response.json()
}
const metrics = async (cookie) => (await json("/v1/operations/metrics", cookie)).data
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)]
try {
  let ready = false
  for (let i = 0; i < 100; i++) {
    if (api.exitCode !== null) throw new Error(logs)
    try { if ((await fetch(`${apiUrl}/v1/bookmarks`)).status === 401) { ready = true; break } } catch {}
    await pause(100)
  }
  assert.ok(ready, logs)
  await prisma.user.createMany({ data: users.map((id, index) => ({ id, email: `profile-${id}@example.test`, name: index ? "Privacy integration" : "Performance integration", emailVerified: true })) })
  // Seed valid signed sessions for isolated accounts; OAuth/password configuration is not changed.
  const login = async (userId) => {
    const token = randomUUID()
    await prisma.session.create({ data: { userId, token, expiresAt: new Date(Date.now() + 3600000) } })
    const signature = createHmac("sha256", secret).update(token).digest("base64")
    return `cabinet.session_token=${encodeURIComponent(`${token}.${signature}`)}`
  }
  const cookie = await login(users[0]), otherCookie = await login(users[1])
  assert.equal((await fetch(`${apiUrl}/v1/operations/metrics`, { headers: { Cookie: otherCookie } })).status, 403)
  await prisma.bookmark.createMany({ data: Array.from({ length: 1000 }, (_, index) => {
    const title = `${index % 3 ? "Accessible interface" : "Research reading"} reference ${index}`
    return { userId: users[0], title, sortTitle: title.toLowerCase(), sortDomain: "developer.mozilla.org", url: `https://developer.mozilla.org/en-US/docs/Web?fixture=${index}`, description: "Reference material for layouts, typography, and accessible controls.", metadataStatus: "COMPLETED" }
  }) })
  await pause(10500)
  const idle = await metrics(cookie)
  const requests = []
  const readLoadStarted = performance.now()
  for (const path of ["/v1/bookmarks?limit=20", "/v1/bookmarks?search=interface&limit=20", "/v1/bookmarks?search=interface&domain=developer.mozilla.org&limit=20"]) {
    for (let i = 0; i < 5; i++) await json(path, cookie)
    const durations = []
    let next = 0
    const start = performance.now()
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next++ < 80) { const began = performance.now(); await json(path, cookie); durations.push(performance.now() - began) }
    }))
    const elapsed = performance.now() - start
    requests.push({ path, requests: durations.length, concurrency: 4, p50Ms: +percentile(durations, .5).toFixed(2), p95Ms: +percentile(durations, .95).toFixed(2), requestsPerSecond: +(durations.length / elapsed * 1000).toFixed(2) })
  }
  const afterReadLoad = await metrics(cookie)
  const readLoadDurationMs = performance.now() - readLoadStarted
  const readLoadCpuAverage = +((afterReadLoad.cpuTotalMicros - idle.cpuTotalMicros) / (readLoadDurationMs * 1000) * 100).toFixed(2)
  const html = `<DL><H3>Profiling import</H3><DL>${Array.from({ length: 500 }, (_, index) => `<A HREF="https://cabinet-profile.invalid/${index}">Import reference ${index}</A>`).join("")}</DL></DL>`
  const queued = (await json("/v1/bookmarks/import", cookie, { htmlContent: html })).data
  assert.ok(queued.id)
  const workerSamples = []
  let completed = false
  for (let i = 0; i < 180; i++) {
    const activity = (await json("/v1/activity", cookie)).data
    const task = activity.tasks.find((task) => task.id === queued.id)
    assert.notEqual(task?.status, "FAILED", JSON.stringify(task))
    if (task?.status === "RUNNING") workerSamples.push(await metrics(cookie))
    if (task?.status === "COMPLETED") { assert.equal(task.processed, 500); completed = true; break }
    await pause(500)
  }
  assert.ok(completed, "Import did not finish")
  assert.ok(workerSamples.length > 0, "No active-worker measurements were observed")
  assert.equal(await prisma.bookmark.count({ where: { userId: users[0], source: "IMPORT" } }), 500)
  const hidden = (await json("/v1/activity", otherCookie)).data
  assert.deepEqual(hidden.tasks, [])
  assert.deepEqual(hidden.metadata, [])
  assert.equal((await fetch(`${apiUrl}/v1/activity/tasks/${queued.id}/retry`, { method: "POST", headers: { Cookie: otherCookie, Origin: origin } })).status, 404)
  const taskInDb = await prisma.backgroundTask.findUnique({ where: { id: queued.id } })
  assert.equal(taskInDb.payload, null)
  const source = await json("/v1/bookmarks", cookie, { url: "https://react.dev/learn", title: "Saved by extension", description: "A useful React reference", imageUrl: "https://react.dev/cover.png", source: "EXTENSION", contentType: "ARTICLE", clientRequestId: randomUUID(), expectedUserId: users[0] })
  assert.equal(source.data.metadataStatus, "COMPLETED")
  assert.equal(source.data.contentType, "ARTICLE")
  assert.equal((await json("/v1/activity/overview", cookie)).data.onboarding.extensionSaved, true)
  const finalMetrics = await metrics(cookie)
  assert.ok(finalMetrics.queries.some((query) => query.name.includes("bookmarks") && query.count > 0), "Prisma query instrumentation did not emit measurements")
  assert.ok(finalMetrics.routes.some((route) => route.name.includes("[search]")), "Search route was not measured separately")
  const report = { measuredAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch, apiMode: "compiled NestJS, isolated PostgreSQL database and Redis queues; periodic scans disabled" }, fixture: { initialBookmarks: 1000, importedBookmarks: 500 }, idle: { memoryBytes: idle.memoryBytes, cpuPercent: idle.cpuPercent, eventLoop: idle.eventLoop }, readLoad: { endpoints: requests, memoryBytes: afterReadLoad.memoryBytes, sampledCpuPercent: afterReadLoad.cpuPercent, averageCpuPercent: readLoadCpuAverage, durationMs: +readLoadDurationMs.toFixed(2) }, workerLoad: { samples: workerSamples.length, peakRssBytes: Math.max(...workerSamples.map((sample) => sample.memoryBytes.rss)), peakCpuPercent: Math.max(...workerSamples.map((sample) => sample.cpuPercent ?? 0)) }, serverMeasurements: finalMetrics, caveat: "Local baseline, not a before/after comparison or a production capacity guarantee. Other applications and shared PostgreSQL/Redis affect these numbers. Memory covers this API process only, not PostgreSQL, Redis, Next.js, or child media processes." }
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify({ readLoad: report.readLoad, idleRssMiB: +(idle.memoryBytes.rss / 1048576).toFixed(2), workerPeakRssMiB: +(report.workerLoad.peakRssBytes / 1048576).toFixed(2) }, null, 2))
  console.log("PASS real API profiling, query instrumentation, durable import progress, account isolation, metrics access and truthful extension onboarding")
} finally {
  if (api.exitCode === null) { api.kill("SIGTERM"); await Promise.race([once(api, "exit"), pause(3000)]); if (api.exitCode === null) api.kill("SIGKILL") }
  try {
    for (const name of ["cabinet-tasks", "bookmark-enrichment"]) {
      const queue = new Queue(name, { prefix, connection: { host: process.env.REDIS_HOST || "127.0.0.1", port: Number(process.env.REDIS_PORT || 6379), maxRetriesPerRequest: 1, enableOfflineQueue: false } })
      try { await queue.obliterate({ force: true }) } finally { await queue.close() }
    }
  } finally {
    try { await prisma.$disconnect() } finally { await database.cleanup() }
  }
}

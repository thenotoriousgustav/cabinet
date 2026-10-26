// Stateful API fixtures only. No real user, job queue, or library is modified.
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium, expect as baseExpect } from "@playwright/test"
import { cabinetResponse, folder as sampleFolder, bookmarks as sampleItems } from "./fixtures/cabinet-data.mjs"
const expect = baseExpect.configure({ timeout: 15000 })
const origin = process.env.WEB_URL || "http://localhost:3000"
const errors = [], writes = [], items = [], folders = []
const onboarding = { dismissed: false, savedLink: false, organized: false, extensionSaved: false }
let operator = false, activityError = false, metricsRequests = 0
let tasks = [
  { id: "11111111-1111-4111-8111-111111111111", kind: "IMPORT", status: "RUNNING", processed: 12, total: 40, failed: 0, attempt: 1, error: null, createdAt: "2026-10-24T09:00:00Z", updatedAt: "2026-10-24T09:02:00Z" },
  { id: "22222222-2222-4222-8222-222222222222", kind: "LINK_CHECK", status: "FAILED", processed: 4, total: 10, failed: 1, attempt: 3, error: "Link check interrupted. Retry safely from Activity.", createdAt: "2026-10-24T08:00:00Z", updatedAt: "2026-10-24T08:02:00Z" },
]
let metadata = [{ id: "33333333-3333-4333-8333-333333333333", title: "A reference worth keeping", url: "https://react.dev/learn", metadataStatus: "FAILED", metadataError: "The website did not answer. Your bookmark is saved.", updatedAt: "2026-10-24T09:00:00Z", lastEnrichedAt: null }]
const summary = () => ({ pending: tasks.filter((task) => task.status === "PENDING").length + metadata.filter((item) => item.metadataStatus === "PENDING").length, running: tasks.filter((task) => task.status === "RUNNING").length, failed: tasks.filter((task) => task.status === "FAILED").length + metadata.filter((item) => item.metadataStatus === "FAILED").length, completed: tasks.filter((task) => task.status === "COMPLETED").length + metadata.filter((item) => item.metadataStatus === "COMPLETED").length, onboarding })
const measured = { startedAt: "2026-10-24T08:00:00Z", measuredAt: "2026-10-24T09:00:00Z", uptimeSeconds: 3600, memoryBytes: { rss: 290 * 1048576, heapUsed: 75 * 1048576, heapTotal: 120 * 1048576, external: 8 * 1048576 }, cpuTotalMicros: 1000000, cpuPercent: 12.5, eventLoop: { meanMs: 20.1, p95Ms: 21.3 }, routes: [{ name: "GET /v1/bookmarks [search]", count: 80, errors: 0, samples: 80, p50Ms: 10, p95Ms: 16, maxMs: 22 }], queries: [{ name: "SELECT bookmarks", count: 320, errors: 0, samples: 320, p50Ms: 1, p95Ms: 4, maxMs: 8 }], jobs: { tasks: { RUNNING: 1, FAILED: 1 }, metadata: { FAILED: 1 } }, sampling: "Latency percentiles use the last 512 samples per group. Counters reset on API restart. CPU is relative to one core." }
const designChecks = []
const inspect = async (page, screen, width) => {
  if (!process.env.DESIGN_INSPECT) return
  const probes = await import(new URL("../../../.agents/skills/design-taste-frontend/scripts/lib/probe.mjs", import.meta.url))
  const rules = await import(new URL("../../../.agents/skills/design-taste-frontend/scripts/lib/rules.mjs", import.meta.url))
  await page.evaluate(async () => document.fonts.ready)
  const measurements = await page.evaluate(probes.probe)
  const layout = await page.evaluate(probes.layout)
  const app = await page.evaluate(probes.app)
  const findings = [...rules.judge(measurements, { width }), ...rules.judgeLayout(layout, { width })].filter((finding) => !rules.APP_SKIP.has(finding.id) && !["no-title", "small-title"].includes(finding.id))
  findings.push(...rules.judgeApp(app, measurements, { width }))
  designChecks.push({ screen, width, findings })
}
const browser = await chromium.launch({ headless: true })
await mkdir(".taste-skill/activity/check", { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
  await context.addCookies([{ name: "cabinet.session_token", value: "test-session", url: origin }])
  await context.route("**/v1/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "content-type" }, body: JSON.stringify(body) })
    if (request.method() === "OPTIONS") return reply({})
    if (!["GET", "OPTIONS"].includes(request.method())) writes.push({ path, body: request.postDataJSON() })
    if (path === "/v1/activity/overview") return reply({ data: summary() })
    if (path === "/v1/activity/onboarding") { onboarding.dismissed = request.postDataJSON().dismissed; return reply({ data: { dismissed: onboarding.dismissed } }) }
    if (path === "/v1/activity") {
      const page = Number(url.searchParams.get("page") || 1), from = (page - 1) * 30
      return activityError ? reply({}, 500) : reply({ data: { summary: summary(), tasks: tasks.slice(from, from + 30), metadata: metadata.slice(from, from + 30), page, hasMore: tasks.length > from + 30 || metadata.length > from + 30 } })
    }
    if (path.includes("/v1/activity/tasks/")) { tasks.find((task) => path.includes(task.id)).status = "PENDING"; return reply({ data: tasks[1] }) }
    if (path.includes("/v1/activity/metadata/")) { metadata[0].metadataStatus = "PENDING"; metadata[0].metadataError = null; return reply({ data: metadata[0] }) }
    if (path === "/v1/operations/access") return reply({ data: { enabled: operator } })
    if (path === "/v1/operations/metrics") { metricsRequests++; return operator ? reply({ data: measured }) : reply({}, 403) }
    if (path === "/v1/bookmarks/saved-searches") return reply({ data: [] })
    if (path === "/v1/bookmarks/bulk/tags") { onboarding.organized = true; for (const item of items) item.tags = request.postDataJSON().tags.map((name) => ({ name })); return reply({ data: { updated: items.length } }) }
    if (path === "/v1/bookmarks/import") return reply({ data: { id: "44444444-4444-4444-8444-444444444444", status: "PENDING" } })
    if (path === "/v1/bookmarks" && request.method() === "POST") {
      const body = request.postDataJSON()
      items.push({ ...sampleItems[0], ...body, id: "first-save", imageUrl: null, folder: null, folderId: null })
      onboarding.savedLink = true
      return reply({ data: items.at(-1) })
    }
    if (path === "/v1/bookmarks") return reply({ data: { data: url.searchParams.has("search") ? [] : items, totalCount: items.length, nextCursor: null } })
    if (path === "/v1/folders" && request.method() === "POST") { folders.push({ ...sampleFolder, name: request.postDataJSON().name, _count: { bookmarks: 0 } }); return reply({ data: folders.at(-1) }) }
    if (path === "/v1/folders") return reply({ data: folders })
    if (path === "/v1/bookmarks/health") return reply({ data: { total: items.length, ok: items.length, broken: 0, favorites: 0, archived: 0, trash: 0, duplicates: 0 } })
    return reply(cabinetResponse(url.href))
  })
  const page = await context.newPage()
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`${origin}/cabinet`)
  await expect(page.getByRole("heading", { name: "A library worth returning to" })).toBeVisible()
  await expect(page.getByText(/0 of 3 steps complete/)).toBeVisible()
  await page.getByRole("link", { name: "Set up extension", exact: true }).click()
  await expect(page.getByRole("tab", { name: "Ekstensi 1-Klik" })).toHaveAttribute("data-state", "active")
  await expect(page.getByText("Pasang ekstensi dari folder proyek", { exact: true })).toBeVisible()
  assert.equal(onboarding.extensionSaved, false, "opening the setup guide must not claim installation or a completed save")
  await page.goto(`${origin}/cabinet`)
  await page.getByRole("button", { name: "Dismiss getting started" }).click()
  await expect(page.getByRole("heading", { name: "A library worth returning to" })).toHaveCount(0)
  await page.goto(`${origin}/cabinet/activity`)
  await page.getByRole("button", { name: "Show getting started" }).click()
  await page.goto(`${origin}/cabinet`)
  await page.getByRole("button", { name: "Save a link", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("URL", { exact: true }).fill("https://react.dev/learn")
  await dialog.getByLabel("Title (Optional)", { exact: true }).fill("A reference worth keeping")
  await dialog.getByRole("button", { name: "Save bookmark", exact: true }).click()
  await expect(page.getByText(/1 of 3 steps complete/)).toBeVisible()
  await page.getByRole("button", { name: "Organize your library", exact: true }).click()
  await expect(page.getByText(/1 of 3 steps complete/)).toBeVisible()
  assert.equal(onboarding.organized, false, "opening organization controls must not claim an item was organized")
  await page.getByRole("textbox", { name: "Tag name", exact: true }).fill("reading")
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByText(/2 of 3 steps complete/)).toBeVisible()
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.waitForTimeout(700)
    await inspect(page, "onboarding", width)
    await page.screenshot({ path: `.taste-skill/activity/check/onboarding-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${origin}/cabinet/integrations`)
  await page.getByLabel("Pilih berkas HTML bookmark untuk diimpor").setInputFiles({ name: "bookmarks.html", mimeType: "text/html", buffer: Buffer.from('<DL><A HREF="https://react.dev">React</A></DL>') })
  await expect(page.getByText("Impor sedang diproses di latar belakang", { exact: true })).toBeVisible()
  await expect(page.getByText(/Impor selesai!/)).toHaveCount(0)
  await page.goto(`${origin}/cabinet/activity`)
  await expect(page.getByRole("progressbar", { name: "Import progress" })).toHaveAttribute("value", "12")
  await expect(page.getByRole("link", { name: "Server measurements", exact: true })).toHaveCount(0)
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await inspect(page, "activity", width)
    await page.screenshot({ path: `.taste-skill/activity/check/activity-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  await page.getByRole("button", { name: "Retry metadata for A reference worth keeping" }).click()
  await expect.poll(() => writes.some((write) => write.path.includes("/activity/metadata/"))).toBe(true)
  await page.getByRole("button", { name: "Retry", exact: true }).click()
  await expect.poll(() => writes.some((write) => write.path.includes("/activity/tasks/"))).toBe(true)
  activityError = true
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(page.getByText("Could not load activity", { exact: true })).toBeVisible()
  activityError = false
  await page.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(page.getByText("Could not load activity", { exact: true })).toHaveCount(0)
  await page.goto(`${origin}/cabinet/operations`)
  await expect(page.getByText("Operator access required", { exact: true })).toBeVisible()
  assert.equal(metricsRequests, 0)
  operator = true
  await page.reload()
  await expect(page.getByRole("table", { name: "API latency", exact: true })).toBeVisible()
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await inspect(page, "operations", width)
    await page.screenshot({ path: `.taste-skill/activity/check/operations-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  tasks = []; metadata = []
  await page.goto(`${origin}/cabinet/activity`)
  await expect(page.getByText("No background tasks yet", { exact: true })).toBeVisible()
  await expect(page.getByText("No metadata work yet", { exact: true })).toBeVisible()
  tasks = Array.from({ length: 35 }, (_, index) => ({ id: `history-${index}`, kind: "LINK_CHECK", status: "COMPLETED", processed: 1, total: 1, failed: 0, attempt: 1, error: null, createdAt: "2026-10-24T08:00:00Z", updatedAt: "2026-10-24T08:00:00Z" }))
  await page.reload()
  await page.getByRole("button", { name: "Next page", exact: true }).click()
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible()
  await expect(page.getByRole("listitem")).toHaveCount(5)
  await page.getByRole("button", { name: "Previous page", exact: true }).click()
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible()
  assert.deepEqual(errors, [])
  if (process.env.DESIGN_INSPECT) await writeFile(".taste-skill/activity/check/inspection.json", JSON.stringify(designChecks, null, 2))
  console.log("PASS truthful onboarding/dismiss/reopen, extension setup deep link, async import status, live progress, retries, failure recovery, operator restrictions, empty states, and responsive screens")
} finally { await browser.close() }

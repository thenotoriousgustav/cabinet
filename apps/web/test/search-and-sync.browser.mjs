import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { chromium, expect } from "@playwright/test"
import { cabinetResponse, bookmarks } from "./fixtures/cabinet-data.mjs"
const origin = process.env.WEB_URL || "http://localhost:3000"
const noteId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const requests = [], writes = [], errors = []
let offline = false, loseResponse = false
let note = { id: noteId, userId: "owner", type: "NOTE", access: "owner", title: "Original note", notes: "Keep this text", folderId: null, tags: [], noteRevision: 0, noteSaveId: null, noteDocument: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Keep this text" }] }] } }
const browser = await chromium.launch({ headless: true })
await mkdir(".taste-skill/search-sync", { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
  await context.addCookies([{ name: "cabinet.session_token", value: "test", url: origin }])
  await context.route("**/v1/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    requests.push({ method: request.method(), path, query: Object.fromEntries(url.searchParams) })
    const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "content-type" }, body: JSON.stringify(body) })
    if (request.method() === "OPTIONS") return reply({})
    if (path.endsWith(`/bookmarks/${noteId}/note`)) {
      const body = request.postDataJSON()
      writes.push(body)
      if (offline) return reply({ message: "Offline fixture" }, 503)
      if (note.noteSaveId === body.saveId) return reply({ data: note })
      if (body.baseRevision !== note.noteRevision) return reply({ message: "Conflict fixture" }, 409)
      note = { ...note, ...body, noteRevision: note.noteRevision + 1, noteSaveId: body.saveId }
      if (loseResponse) { loseResponse = false; return route.abort("failed") }
      return reply({ data: note })
    }
    if (path.endsWith(`/bookmarks/${noteId}`)) return reply({ data: note })
    if (path.endsWith("/bookmarks")) return reply({ data: { data: bookmarks.map((item) => ({ ...item, imageUrl: null })), totalCount: bookmarks.length, nextCursor: null } })
    return reply(cabinetResponse(url.href))
  })
  const page = await context.newPage()
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`${origin}/cabinet`)
  await page.getByRole("searchbox", { name: "Search bookmarks" }).fill("design")
  await expect.poll(() => requests.filter((request) => request.path.endsWith("/bookmarks")).at(-1)?.query.sort).toBe("relevance")
  await expect(page.locator("mark").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Filters", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Saved searches", exact: true })).toHaveCount(0)
  await expect(page.getByRole("link", { name: /^Activity/ })).toHaveCount(0)
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(async () => page.locator('[data-slot="masonry-item"]').first().evaluate((element) => element.getBoundingClientRect().right <= innerWidth)).toBe(true)
    await page.waitForTimeout(500)
    await page.screenshot({ path: `.taste-skill/search-sync/search-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${origin}/cabinet/notes/${noteId}`)
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Original note")
  offline = true
  await page.getByRole("textbox", { name: "Note title" }).fill("Saved through reconnect")
  await expect(page.getByText("Waiting to sync", { exact: true }).first()).toBeVisible()
  assert.ok(await page.evaluate((id) => localStorage.getItem(`cabinet:note-draft:v1:owner:${id}`), noteId))
  offline = false
  await page.evaluate(() => window.dispatchEvent(new Event("online")))
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible()
  assert.equal(note.title, "Saved through reconnect")
  loseResponse = true
  await page.getByRole("textbox", { name: "Note title" }).fill("Lost response is safe")
  await expect.poll(() => writes.filter((write) => write.title === "Lost response is safe").length).toBeGreaterThanOrEqual(2)
  const retry = writes.filter((write) => write.title === "Lost response is safe")
  assert.equal(retry[0].saveId, retry[1].saveId)
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible()
  const second = await context.newPage()
  second.on("pageerror", (error) => errors.push(error.message))
  await second.goto(`${origin}/cabinet/notes/${noteId}`)
  await expect(second.getByRole("textbox", { name: "Note title" })).toHaveValue("Lost response is safe")
  await page.getByRole("textbox", { name: "Note title" }).fill("First tab wins")
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible()
  await second.getByRole("textbox", { name: "Note title" }).fill("Second tab keeps draft")
  await expect(second.getByText("This note changed elsewhere", { exact: true })).toBeVisible()
  assert.equal(note.title, "First tab wins")
  await second.screenshot({ path: ".taste-skill/search-sync/note-conflict.png", fullPage: true })
  await second.getByRole("button", { name: "Keep my draft", exact: true }).click()
  await expect(second.getByText("All changes saved", { exact: true })).toBeVisible()
  assert.equal(note.title, "Second tab keeps draft")
  assert.deepEqual(errors, [])
  console.log("PASS browser search, hidden toolbar actions, highlights, mobile overflow, note reconnect, lost-response idempotency and two-tab conflict resolution")
} finally { await browser.close() }

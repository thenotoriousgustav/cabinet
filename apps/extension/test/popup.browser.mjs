// Loads the extension in Chromium and drives its popup against a small local server that plays
// the Cabinet API. No real account or data is touched. Run: node test/popup.browser.mjs [screenshot-dir]
//
// A real server (rather than Playwright routing) is used so the browser's own cookie handling is
// exercised: the test proves the Cabinet session cookie reaches the API from the extension.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const source = join(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(join(source, "../web/package.json"))
const { chromium, expect: baseExpect } = require("@playwright/test")
const expect = baseExpect.configure({ timeout: 15000 })
const shots = process.argv[2]

let signedIn = false, unavailable = false, loseResponse = false
const posts = []
const cookies = []
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1")
  const json = (body, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)) }
  if (url.pathname === "/notes") {
    res.writeHead(200, { "content-type": "text/html" })
    return res.end("<title>Field notes on quiet interfaces</title><h1>Field notes</h1><p id=first>Quiet screens help.</p><p id=second>Fewer badges, too.</p>")
  }
  if (unavailable && url.pathname.startsWith("/v1/")) return json({ message: "Offline fixture" }, 503)
  cookies.push(req.headers.cookie || "")
  if (url.pathname === "/v1/auth/get-session") return json(signedIn ? { user: { id: "me", name: "Gustav" }, session: { id: "s" } } : null)
  if (!signedIn) return json({ message: "Invalid or expired session" }, 401)
  if (url.pathname === "/v1/folders") return json({ success: true, data: [
    { id: "f-mine", name: "Reading list", isOwner: true, access: "OWNER" },
    { id: "f-view", name: "Team archive", isOwner: false, access: "VIEWER" },
    { id: "f-edit", name: "Team links", isOwner: false, access: "EDITOR" },
  ] })
  if (url.pathname === "/v1/tags") return json({ success: true, data: [{ name: "design" }, { name: "research" }] })
  if (url.pathname === "/v1/bookmarks" && req.method === "GET") {
    return json({ success: true, data: { data: [{ id: "old", url: `${origin}/notes/`, folderId: "f-mine", folder: { name: "Reading list" } }], nextCursor: null } })
  }
  if (url.pathname === "/v1/bookmarks" && req.method === "POST") {
    let body = ""
    for await (const chunk of req) body += chunk
    posts.push(JSON.parse(body))
    if (loseResponse) { loseResponse = false; return json({ message: "Lost acknowledgement fixture" }, 503) }
    return json({ success: true, data: { id: "new" } }, 201)
  }
  json({ success: true, data: [] })
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const origin = `http://127.0.0.1:${server.address().port}`

// A copy of the extension that may reach the test server.
const work = await mkdtemp(join(tmpdir(), "cabinet-extension-"))
const extensionPath = join(work, "extension")
await cp(source, extensionPath, { recursive: true, filter: (path) => !path.includes("node_modules") })
const manifest = JSON.parse(await readFile(join(extensionPath, "manifest.json"), "utf8"))
manifest.host_permissions.push(`${origin}/*`)
await writeFile(join(extensionPath, "manifest.json"), JSON.stringify(manifest))

const context = await chromium.launchPersistentContext(join(work, "profile"), {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
})
try {
  // Cabinet's session cookie is SameSite=Lax, as better-auth sets it.
  await context.addCookies([{ name: "cabinet.session_token", value: "test-session", url: origin, sameSite: "Lax" }])
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker")
  const extensionId = new URL(worker.url()).host
  await worker.evaluate(async (apiUrl) => chrome.storage.sync.set({ apiUrl, appUrl: "http://localhost:3000" }), origin)

  const article = await context.newPage()
  await article.goto(`${origin}/notes#intro`)
  const articleTabId = await worker.evaluate(async (pattern) => (await chrome.tabs.query({ url: pattern }))[0].id, `${origin}/*`)

  const popup = await context.newPage()
  await popup.setViewportSize({ width: 360, height: 520 })
  const open = (tabId) => popup.goto(`chrome-extension://${extensionId}/src/popup.html?tab=${tabId}`)

  // Signed out: one clear next step.
  await open(articleTabId)
  await expect(popup.getByText("Sign in to Cabinet")).toBeVisible()
  await expect(popup.getByRole("button", { name: "Sign in" })).toBeVisible()
  if (shots) await popup.screenshot({ path: join(shots, "ext-signed-out.png") })

  // Signed in: the form, with only folders this person may add to.
  signedIn = true
  await open(articleTabId)
  await expect(popup.getByLabel("Title")).toHaveValue("Field notes on quiet interfaces")
  await expect(popup.locator("#host")).toHaveText("127.0.0.1")
  assert.deepEqual(await popup.locator("#folder option").allTextContents(), ["Unfiled", "Reading list", "Team links (shared)"])
  await expect(popup.getByRole("status").filter({ hasText: "Already in your Cabinet in Reading list" })).toBeVisible()
  assert.ok(cookies.length > 0 && cookies.every((cookie) => cookie.includes("cabinet.session_token=test-session")),
    `the session cookie reaches the API: ${JSON.stringify(cookies)}`)

  await popup.getByLabel("Title").fill("Quiet interfaces")
  await popup.getByLabel("Folder").selectOption("f-edit")
  const tagInput = popup.getByLabel("Tags")
  await tagInput.fill("#Design")
  await tagInput.press("Enter")
  await tagInput.fill("ux")
  await tagInput.press(",")
  await expect(popup.locator(".chip")).toHaveText(["#design×", "#ux×"])
  if (shots) await popup.screenshot({ path: join(shots, "ext-form.png") })
  await popup.getByRole("button", { name: "Save" }).click()
  await expect(popup.getByText("Saved", { exact: true })).toBeVisible()
  await expect(popup.locator("#saved-text")).toHaveText("In Team links · #design #ux")
  const { clientRequestId, expectedUserId, source: saveSource, ...savedBody } = posts.at(-1)
  assert.equal(saveSource, "EXTENSION")
  assert.match(clientRequestId, /^[a-f0-9-]{36}$/)
  assert.equal(expectedUserId, "me")
  assert.deepEqual(savedBody, { type: "BOOKMARK", url: `${origin}/notes#intro`, title: "Quiet interfaces", folderId: "f-edit", tags: ["design", "ux"] })
  if (shots) await popup.screenshot({ path: join(shots, "ext-saved.png") })

  // The folder is remembered for next time.
  await open(articleTabId)
  await expect(popup.getByLabel("Folder")).toHaveValue("f-edit")

  // A tab the extension cannot read, such as a browser page, cannot be saved.
  const blank = await context.newPage()
  await blank.goto("about:blank")
  const blankTabId = await worker.evaluate(async () => (await chrome.tabs.query({})).at(-1).id)
  await open(blankTabId)
  await expect(popup.getByText("This page can't be saved")).toBeVisible()

  // Highlights: the worker reads the selection with its line breaks, then it is saved as a quote note.
  await article.evaluate(() => {
    const range = document.createRange()
    range.setStartBefore(document.querySelector("#first"))
    range.setEndAfter(document.querySelector("#second"))
    getSelection().removeAllRanges()
    getSelection().addRange(range)
  })
  const selected = await worker.evaluate(async (tabId) => (await chrome.scripting.executeScript({ target: { tabId }, func: () => String(getSelection()) }))[0].result, articleTabId)
  assert.match(selected, /Quiet screens help\.\n+Fewer badges, too\./)
  await open(articleTabId)
  await popup.evaluate(async ({ text, url }) => (await import("./cabinet.js")).saveHighlight({ text, url, title: "Field notes", folderId: "f-mine" }), { text: selected, url: `${origin}/notes` })
  const highlight = posts.at(-1)
  assert.deepEqual({ type: highlight.type, url: highlight.url, title: highlight.title, folderId: highlight.folderId }, { type: "NOTE", url: `${origin}/notes`, title: "Field notes", folderId: "f-mine" })
  assert.deepEqual(highlight.noteDocument.content[0].content.map((block) => block.content[0].text), ["Quiet screens help.", "Fewer badges, too."])
  assert.equal(highlight.noteDocument.content[1].content[0].marks[0].attrs.href, `${origin}/notes`)

  // Cached identity and folders allow offline capture; the queue survives closing/reopening the popup.
  unavailable = true
  await open(articleTabId)
  await expect(popup.getByLabel("Title")).toBeVisible()
  await popup.getByLabel("Title").fill("Offline bookmark")
  await popup.getByRole("button", { name: "Save", exact: true }).click()
  await expect(popup.getByText("Saved locally", { exact: true })).toBeVisible()
  const pending = await worker.evaluate(async () => (await chrome.storage.local.get("outbox")).outbox)
  assert.equal(pending.length, 1)
  await open(articleTabId)
  await expect(popup.getByText("1 save waiting to sync", { exact: true })).toBeVisible()
  unavailable = false
  loseResponse = true
  await popup.getByRole("button", { name: "Retry sync", exact: true }).click()
  await expect.poll(() => posts.filter((body) => body.title === "Offline bookmark").length).toBe(1)
  await popup.getByRole("button", { name: "Retry sync", exact: true }).click()
  await expect(popup.locator("#outbox-panel")).toBeHidden()
  const retries = posts.filter((body) => body.title === "Offline bookmark")
  assert.equal(retries.length, 2)
  assert.equal(retries[0].clientRequestId, retries[1].clientRequestId)
  assert.equal(retries[0].clientRequestId, pending[0].id)

  console.log("PASS offline queue/reopen/retry and lost-response stable IDs; signed-out prompt, session cookie sent, writable folders only, duplicate notice, tags, save payload, remembered folder, unsupported pages, highlight selection and save")
} finally {
  await context.close()
  server.close()
  await rm(work, { recursive: true, force: true })
}

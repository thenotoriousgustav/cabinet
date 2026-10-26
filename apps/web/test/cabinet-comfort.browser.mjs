// Requires the web dev server. API data below is explicitly mock data.
// node test/cabinet-comfort.browser.mjs
import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { chromium, expect } from "@playwright/test"
import { folder, samples, bookmarks, cabinetResponse, prepareCabinetImages } from "./fixtures/cabinet-data.mjs"

const origin = process.env.WEB_URL || "http://localhost:3000"
const directory = "/tmp/cabinet-comfort"
await mkdir(directory, { recursive: true })
const images = await prepareCabinetImages()
let emptyBookmarks = false
let failBookmarks = false
let failWrites = false
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext()
  await context.addCookies([{ name: "cabinet.session_token", value: "browser-test", url: origin }])
  await context.route("https://jdan.github.io/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Website preview test</h1>" }))
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url())
    const image = images.get(url.searchParams.get("url"))
    if (image) return route.fulfill(image)
    const isBookmarks = url.pathname.endsWith("/bookmarks")
    const body = isBookmarks && emptyBookmarks ? { data: { data: [], totalCount: 0, nextCursor: null } } : cabinetResponse(url.href)
    await route.fulfill({ status: isBookmarks && (failBookmarks || (failWrites && route.request().method() === "POST")) ? 500 : 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" }, body: JSON.stringify(body) })
  })
  await page.addInitScript(() => {
    if (!localStorage.getItem("cabinet_view_mode")) localStorage.setItem("cabinet_view_mode", "moodboard")
    // Preferences from before the density option must still load as Comfortable.
    if (!localStorage.getItem("cabinet_display_preferences")) localStorage.setItem("cabinet_display_preferences", JSON.stringify({ showTitle: true, showDescription: true, showImage: true, showWebsite: true, showFolder: true, showDate: true }))
  })
  for (const theme of ["light", "dark"]) {
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 960 })
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
      await page.goto(`${origin}/cabinet`)
      await expect(page.locator('[data-slot="masonry"]')).toBeVisible()
      await expect(page.getByRole("link", { name: samples[0][0], exact: true })).toBeVisible()
      await expect(page.locator('[data-slot="card"]').first()).toHaveCSS("border-top-left-radius", "8px")
      await page.evaluate(() => document.fonts.ready)
      assert.ok(await page.evaluate(() => [...document.fonts].some((font) => /^geist$/i.test(font.family.replaceAll('"', '')) && font.status === "loaded")), "The actual Geist font must be loaded, not just a declared fallback")
      await expect.poll(() => page.locator('[data-slot="masonry"] img').evaluateAll((images) => images.every((image) => image.complete))).toBe(true)
      await expect.poll(() => page.locator('[data-slot="masonry-item"]').evaluateAll((nodes) => {
        const rects = nodes.map((node) => node.getBoundingClientRect())
        return rects.every((a, i) => rects.every((b, j) => i === j || a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1))
      })).toBe(true)
      if (width >= 1024) assert.ok(await page.locator("header").first().evaluate((element) => element.getBoundingClientRect().height <= 80), "Desktop header must stay on one line")
      await page.screenshot({ path: `${directory}/${theme}-${width}.png`, animations: "disabled" })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width}: horizontal page overflow`)
      const title = page.getByRole("link", { name: samples[0][0], exact: true })
      await expect(title).toHaveAttribute("target", "_blank")
      if (width === 390) {
        await page.locator('[data-slot="card"]').filter({ has: title }).locator("p").filter({ hasText: "A collection of components" }).click()
        await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1")
        await expect(page.getByLabel("Bookmark inspector")).toBeVisible()
        assert.ok(await page.getByRole("dialog").evaluate((element) => element.scrollWidth <= element.clientWidth), "Mobile webview must not overflow")
        await page.screenshot({ path: `${directory}/${theme}-mobile-webview.png`, animations: "disabled" })
        await page.keyboard.press("Escape")
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(`${origin}/cabinet?folder=${folder.id}`)
  const titleLink = page.getByRole("link", { name: samples[0][0], exact: true })
  const [popup] = await Promise.all([context.waitForEvent("page"), titleLink.click()])
  await popup.waitForURL(samples[0][1])
  await popup.close()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const firstCard = page.locator('[data-slot="card"]').filter({ has: page.getByRole("link", { name: samples[0][0], exact: true }) })
  await firstCard.locator('p').filter({ hasText: "A collection of components" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByLabel("Bookmark inspector")).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1")
  await page.screenshot({ path: `${directory}/webview.png`, animations: "disabled" })
  const titleInput = page.getByRole("textbox", { name: "Title", exact: true })
  await titleInput.fill("Unsaved draft stays intact")
  await page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/bookmarks"), { timeout: 20000 })
  await expect(titleInput).toHaveValue("Unsaved draft stays intact")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
  await page.goto(`${origin}/cabinet`)
  const libraryCard = page.locator('[data-slot="card"]').filter({ has: page.getByRole("link", { name: samples[0][0], exact: true }) })
  await expect(libraryCard.locator('[data-slot="card-content"]')).toHaveCSS("padding", "16px")
  await page.getByRole("button", { name: "Display options", exact: true }).click()
  await expect(page.getByRole("menuitemradio", { name: "Comfortable", exact: true })).toHaveCount(0)
  await page.getByRole("menuitemradio", { name: "Compact", exact: true }).click()
  await expect(libraryCard.locator('[data-slot="card-content"]')).toHaveCSS("padding", "12px")
  await page.getByRole("button", { name: "Display options", exact: true }).click()
  await page.getByRole("menuitemcheckbox", { name: "Folder", exact: true }).click()
  await page.getByRole("menuitemcheckbox", { name: "Date added", exact: true }).click()
  await page.keyboard.press("Escape")
  await expect(libraryCard.getByTitle("Date added", { exact: true })).toHaveCount(0)
  await expect(libraryCard.getByTitle(folder.name, { exact: true })).toHaveCount(0)
  await page.locator('[aria-label="List View"]:visible').click()
  await expect(page.locator('[data-slot="masonry"]')).toHaveCount(0)
  await expect(page.getByRole("link", { name: samples[0][0], exact: true })).toHaveAttribute("target", "_blank")
  await page.screenshot({ path: `${directory}/list-1440.png`, animations: "disabled" })

  await page.goto(`${origin}/cabinet/settings`)
  await expect(page.locator('[aria-label="Density"] [data-state="on"]')).toHaveText("Compact")
  await expect(page.getByRole("switch", { name: "Folder", exact: true })).not.toBeChecked()
  await page.locator('[aria-label="Density"]').getByText("Comfortable", { exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Saved on this device")
  await expect(page.locator('[aria-label="Display preview"] [data-slot="card-content"]')).toHaveCSS("padding", "16px")
  await page.getByRole("switch", { name: "Preview image", exact: true }).click()
  await expect(page.locator('[aria-label="Display preview"] img')).toHaveCount(0)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await page.getByRole("tab", { name: "Appearance", exact: true }).click()
    await page.screenshot({ path: `${directory}/settings-${width}.png`, fullPage: true, animations: "disabled" })
    for (const tab of ["Account", "Data & Export", "Maintenance", "Shortcuts"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Settings ${tab} ${width}: overflow`)
    }
  }

  await page.goto(`${origin}/cabinet`)
  await page.locator('[aria-label="Moodboard View"]:visible').click()
  await page.getByRole("button", { name: "Bookmark actions", exact: true }).first().click()
  const [favoriteRequest] = await Promise.all([
    page.waitForRequest((request) => request.method() === "PATCH" && request.url().includes("/sample-0")),
    page.getByRole("button", { name: "Remove from favorites", exact: true }).click(),
  ])
  assert.equal(favoriteRequest.postDataJSON().isFavorite, false)
  await page.getByRole("button", { name: "Bookmark actions", exact: true }).first().click()
  await page.getByRole("button", { name: "Select bookmark", exact: true }).click()
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible()
  await page.getByRole("combobox").click()
  await expect(page.getByRole("option", { name: "Root (No Folder)", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("button", { name: "Add to Cabinet", exact: true }).click()
  await page.getByRole("menuitem", { name: "Add bookmark", exact: true }).click()
  await page.getByRole("combobox", { name: "Folder", exact: true }).click()
  await page.getByRole("option", { name: "Root (No Folder)", exact: true }).click()
  await page.getByRole("button", { name: "Save Bookmark", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByText("Enter a link to save.", { exact: true })).toBeVisible()
  failWrites = true
  await page.getByRole("textbox", { name: "URL", exact: true }).fill("https://www.w3.org/WAI/")
  await page.getByRole("button", { name: "Save Bookmark", exact: true }).click()
  await expect(page.getByText("Failed to save item", { exact: true })).toBeVisible()
  await expect(page.getByRole("dialog")).toBeVisible()
  failWrites = false
  await page.getByRole("button", { name: "Save Bookmark", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)

  // The stock sidebar owns desktop/mobile state, branding, and its shortcut.
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(`${origin}/cabinet`)
  await expect(page.locator('[data-slot="sidebar-header"]').getByText("Cabinet", { exact: true })).toBeVisible()
  await expect(page.locator('header').getByText("Cabinet", { exact: true })).toHaveCount(0)
  const sidebar = page.locator('[data-slot="sidebar"][data-state]')
  await expect(sidebar).toHaveAttribute("data-state", "expanded")
  await page.keyboard.press("Control+b")
  await expect(sidebar).toHaveAttribute("data-state", "collapsed")
  await page.reload()
  await expect(sidebar).toHaveAttribute("data-state", "collapsed")
  await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click()
  await expect(sidebar).toHaveAttribute("data-state", "expanded")
  await expect(page.locator('[data-slot="sidebar-content"] [data-folder-drop]').first()).toBeVisible()
  await page.screenshot({ path: `${directory}/sidebar-1440.png`, animations: "disabled" })
  await page.setViewportSize({ width: 390, height: 960 })
  await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click()
  const mobileSidebar = page.getByRole("dialog", { name: "Sidebar", exact: true })
  await expect(mobileSidebar.getByText("Cabinet", { exact: true })).toBeVisible()
  await page.screenshot({ path: `${directory}/sidebar-mobile.png`, animations: "disabled" })
  await mobileSidebar.getByRole("button", { name: "Favorites", exact: true }).click()
  await expect(mobileSidebar).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Favorites", exact: true })).toBeVisible()
  await page.getByRole("radio", { name: "Links only", exact: true }).click()
  await expect(page.locator('[data-slot="masonry"]')).toBeVisible()
  await page.getByRole("radio", { name: "All formats", exact: true }).click()
  await page.getByRole("button", { name: "Folders", exact: true }).click()
  await expect(mobileSidebar).toBeVisible()
  await mobileSidebar.getByRole("button", { name: "Create folder", exact: true }).click()
  const folderDialog = page.getByRole("dialog", { name: "New Folder", exact: true })
  await folderDialog.getByRole("textbox", { name: "Folder Name", exact: true }).fill("Reading queue")
  const parentFolder = folderDialog.getByRole("combobox", { name: "Parent Folder (optional)", exact: true })
  await parentFolder.click()
  await page.getByRole("option", { name: folder.name, exact: true }).click()
  await parentFolder.click()
  await page.getByRole("option", { name: "Root (No parent folder)", exact: true }).click()
  const [createdFolder] = await Promise.all([
    page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/v1/folders"),
    folderDialog.getByRole("button", { name: "Save Folder", exact: true }).click(),
  ])
  assert.equal(createdFolder.postDataJSON().parentId, undefined)
  await expect(folderDialog).toHaveCount(0)
  await mobileSidebar.getByRole("button", { name: /Design references/ }).first().click()
  await expect(mobileSidebar).toHaveCount(0)
  await expect(page.getByRole("heading", { name: folder.name, exact: true })).toBeVisible()
  await page.getByRole("radio", { name: "Links only", exact: true }).click()
  await expect(page.locator('[data-slot="masonry"]')).toBeVisible()
  await page.getByRole("radio", { name: "All formats", exact: true }).click()
  await page.keyboard.press("Control+k")
  await expect(page.getByRole("dialog", { name: "Cabinet Command Menu", exact: true })).toHaveCSS("border-top-left-radius", "12px")
  await page.screenshot({ path: `${directory}/cmdk-mobile.png`, animations: "disabled" })
  await page.getByRole("combobox", { name: "Search commands and bookmarks" }).fill("98.css")
  await expect(page.getByRole("option", { name: samples[0][0], exact: true })).toHaveCSS("border-top-left-radius", "6px")
  const [commandPopup] = await Promise.all([context.waitForEvent("page"), page.keyboard.press("Enter")])
  await commandPopup.waitForURL(samples[0][1])
  await commandPopup.close()
  await expect(page.getByRole("dialog")).toHaveCount(0)

  emptyBookmarks = true
  await page.goto(`${origin}/cabinet`)
  await expect(page.getByRole("heading", { name: "No bookmarks found", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Add bookmark", exact: true }).last().click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  emptyBookmarks = false
  failBookmarks = true
  await page.goto(`${origin}/cabinet`)
  await expect(page.getByRole("heading", { name: "Could not load bookmarks", exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole("heading", { name: "No bookmarks found", exact: true })).toHaveCount(0)
  failBookmarks = false
  await page.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(page.locator('[data-slot="masonry"]')).toBeVisible()
  assert.deepEqual(errors, [])
  console.log(`PASS responsive themes, actual fonts, title/webview behavior, drafts, density and detail persistence, settings tabs, mobile favorites/selection/save failures, shadcn sidebar branding/persistence/shortcut/mobile navigation, nested root-folder creation, real CMDK selection, empty/error/retry. Screenshots: ${directory}`)
} finally { await browser.close() }

import {
  SignedOutError, cleanTags, findExisting, getLastFolderId, getSession, listFolders, listTags,
  openCabinet, pageMetadata, saveBookmark, saveableUrl, setLastFolderId, getOutbox, getSettings,
} from "./cabinet.js"

const $ = (id) => document.getElementById(id)
const states = ["state-loading", "state-message", "state-form", "state-saved"]
const show = (id) => states.forEach((state) => { $(state).hidden = state !== id })

let tab = null
let tags = []
let folders = []
/** Read from the page while the form is shown, so saving does not wait on it. */
let metadata = Promise.resolve({})

function message(title, text, action) {
  $("message-title").textContent = title
  $("message-text").textContent = text
  const button = $("message-action")
  button.hidden = !action
  if (action) {
    button.textContent = action.label
    button.onclick = action.run
  }
  show("state-message")
}

function signedOut() {
  message("Sign in to Cabinet", "Saving uses your Cabinet account in this browser.", {
    label: "Sign in",
    run: async () => { await openCabinet("/login"); window.close() },
  })
}

function folderPath(folderId) {
  return folderId ? `/cabinet/folders/${encodeURIComponent(folderId)}` : "/cabinet"
}

function renderTags() {
  const box = $("tags")
  box.querySelectorAll(".chip").forEach((chip) => chip.remove())
  const input = $("tag-input")
  for (const tag of tags) {
    const chip = document.createElement("span")
    chip.className = "chip"
    chip.append(`#${tag}`)
    const remove = document.createElement("button")
    remove.type = "button"
    remove.setAttribute("aria-label", `Remove tag ${tag}`)
    remove.textContent = "×"
    remove.addEventListener("click", () => { tags = tags.filter((t) => t !== tag); renderTags(); input.focus() })
    chip.append(remove)
    box.insertBefore(chip, input)
  }
}

function addTag(raw) {
  const next = cleanTags([...tags, ...cleanTags(raw)])
  if (next.length !== tags.length) { tags = next; renderTags() }
}

async function checkDuplicate(url) {
  try {
    const existing = await findExisting(url)
    if (!existing) return
    const notice = $("duplicate")
    notice.textContent = `Already in your Cabinet${existing.folder?.name ? ` in ${existing.folder.name}` : ""}. Saving makes another copy. `
    const open = document.createElement("a")
    open.href = "#"
    open.textContent = "Open it"
    open.addEventListener("click", async (event) => {
      event.preventDefault()
      await openCabinet(folderPath(existing.folderId))
      window.close()
    })
    notice.append(open)
    notice.hidden = false
  } catch {
    // The check is a courtesy; saving still works without it.
  }
}

async function refreshOutbox() {
  const items = await getOutbox()
  if (!Array.isArray(items)) return
  $("outbox-panel").hidden = items.length === 0
  $("outbox-summary").textContent = `${items.length} save${items.length === 1 ? "" : "s"} waiting to sync`
  $("outbox-items").replaceChildren(...items.map((item) => {
    const row = document.createElement("li")
    row.append(`${item.body.title || item.body.url || "Highlight"} — ${item.status === "blocked" ? item.error : "Waiting to reconnect"} `)
    const discard = document.createElement("button")
    discard.type = "button"
    discard.className = "button"
    discard.textContent = "Discard"
    discard.onclick = async () => { await chrome.runtime.sendMessage({ type: "cabinet-discard", id: item.id }); await refreshOutbox() }
    row.append(discard)
    return row
  }))
}
$("retry-sync").onclick = async () => {
  $("retry-sync").disabled = true
  try { await chrome.runtime.sendMessage({ type: "cabinet-retry" }); await refreshOutbox() }
  finally { $("retry-sync").disabled = false }
}

async function init() {
  $("open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage())
  // ?tab=<id> lets the popup page be opened in a normal tab (for testing) and still target a page.
  const requestedTab = Number(new URLSearchParams(location.search).get("tab"))
  tab = requestedTab
    ? await chrome.tabs.get(requestedTab).catch(() => null)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  const url = tab && saveableUrl(tab.url || "")
  if (!url) {
    message("This page can't be saved", "Open a web page (http or https) and try again.")
    return
  }

  const user = await getSession()
  if (!user) return signedOut()
  void refreshOutbox()
  const { apiUrl } = await getSettings()
  const cacheKey = `folders:${apiUrl}:${user.id}`

  try {
    const [folderList, tagList, lastFolderId] = await Promise.all([listFolders(), listTags().catch(() => []), getLastFolderId()])
    folders = folderList
    await chrome.storage.local.set({ [cacheKey]: folderList })
    const select = $("folder")
    select.replaceChildren(new Option("Unfiled", ""))
    for (const folder of folders) select.append(new Option(folder.shared ? `${folder.name} (shared)` : folder.name, folder.id))
    select.value = folders.some((folder) => folder.id === lastFolderId) ? lastFolderId : ""
    $("tag-suggestions").replaceChildren(...tagList.map((name) => new Option(name)))
  } catch (error) {
    if (error instanceof SignedOutError) return signedOut()
    folders = (await chrome.storage.local.get({ [cacheKey]: [] }))[cacheKey]
    const select = $("folder")
    select.replaceChildren(new Option("Unfiled", ""), ...folders.map((folder) => new Option(folder.name, folder.id)))
    const last = await getLastFolderId()
    select.value = folders.some((folder) => folder.id === last) ? last : ""
    $("shortcut-hint").textContent = "Offline · saves will queue locally"
  }

  const host = new URL(url).hostname.replace(/^www\./, "")
  $("host").textContent = host
  $("title").value = tab.title || host
  const favicon = $("favicon")
  if (tab.favIconUrl && /^https?:/.test(tab.favIconUrl)) favicon.src = tab.favIconUrl
  else favicon.hidden = true

  metadata = pageMetadata(tab.id)
  show("state-form")
  $("title").focus()
  $("title").select()
  void checkDuplicate(url)
}

$("tag-input").addEventListener("keydown", (event) => {
  const input = event.currentTarget
  if ((event.key === "Enter" || event.key === ",") && input.value.trim()) {
    event.preventDefault()
    addTag(input.value)
    input.value = ""
  } else if (event.key === "Backspace" && !input.value && tags.length) {
    tags = tags.slice(0, -1)
    renderTags()
  }
})
$("tag-input").addEventListener("change", (event) => {
  // Picking a suggestion from the list adds it straight away.
  const input = event.currentTarget
  if (input.value.trim()) { addTag(input.value); input.value = "" }
})

$("state-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  const pending = $("tag-input").value
  if (pending.trim()) { addTag(pending); $("tag-input").value = "" }
  const save = $("save")
  const error = $("error")
  error.hidden = true
  save.disabled = true
  save.textContent = "Saving…"
  const folderId = $("folder").value
  try {
    const result = await saveBookmark({ url: tab.url, title: $("title").value, folderId, tags, metadata: await metadata })
    await setLastFolderId(folderId)
    const folder = folders.find((item) => item.id === folderId)
    $("saved-text").textContent = `In ${folder ? folder.name : "Unfiled"}${tags.length ? ` · ${tags.map((t) => `#${t}`).join(" ")}` : ""}`
    $("saved-title").textContent = result.queued ? "Saved locally" : "Saved"
    if (result.queued) $("saved-text").textContent = result.status === "blocked" ? `Needs attention: ${result.error}` : "Waiting to sync. Cabinet will retry automatically, even after this popup closes."
    await refreshOutbox()
    $("open-saved").onclick = async () => { await openCabinet(folderPath(folderId)); window.close() }
    show("state-saved")
    $("close").focus()
  } catch (failure) {
    if (failure instanceof SignedOutError) return signedOut()
    error.textContent = failure.message || "Couldn't save this page. Try again."
    error.hidden = false
  } finally {
    save.disabled = false
    save.textContent = "Save"
  }
})

$("close").addEventListener("click", () => window.close())

void init()

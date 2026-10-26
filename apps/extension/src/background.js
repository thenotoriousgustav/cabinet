import { SignedOutError, api, getSession, getSettings, setWorkerSave, getLastFolderId, openCabinet, pageMetadata, saveBookmark, saveHighlight, saveableUrl } from "./cabinet.js"
import { createOutbox } from "./outbox.js"

const outbox = createOutbox({
  load: async () => (await chrome.storage.local.get({ outbox: [] })).outbox,
  store: (outbox) => chrome.storage.local.set({ outbox }),
  session: getSession,
  settings: getSettings,
  send: (body) => api("/v1/bookmarks", { method: "POST", body }),
})
setWorkerSave(outbox.save)
const sync = async () => {
  await outbox.flush()
  const items = await outbox.list()
  await chrome.action.setBadgeText({ text: items.length ? String(items.length) : "" })
  await chrome.action.setTitle({ title: items.length ? `${items.length} saves waiting to sync` : "Save to Cabinet" })
}
void chrome.alarms.get("cabinet-sync").then((alarm) => {
  if (!alarm) return chrome.alarms.create("cabinet-sync", { periodInMinutes: 1 })
})
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "cabinet-sync") void sync() })
chrome.runtime.onStartup.addListener(() => void sync())
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  let task
  if (message.type === "cabinet-save") task = outbox.save(message.body)
  else if (message.type === "cabinet-outbox") task = outbox.list()
  else if (message.type === "cabinet-retry") task = outbox.retry().then(() => outbox.list())
  else if (message.type === "cabinet-discard") task = outbox.discard(message.id).then(() => outbox.list())
  if (!task) return
  task.then(respond, (error) => respond({ error: error.message }))
  return true
})

const MENU_PAGE = "cabinet-save-page"
const MENU_LINK = "cabinet-save-link"
const MENU_HIGHLIGHT = "cabinet-save-highlight"

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_PAGE, title: "Save page to Cabinet", contexts: ["page"], documentUrlPatterns: ["http://*/*", "https://*/*"] })
    chrome.contextMenus.create({ id: MENU_LINK, title: "Save link to Cabinet", contexts: ["link"], targetUrlPatterns: ["http://*/*", "https://*/*"] })
    chrome.contextMenus.create({ id: MENU_HIGHLIGHT, title: "Save highlight to Cabinet", contexts: ["selection"], documentUrlPatterns: ["http://*/*", "https://*/*"] })
  })
})

/** A short mark on the toolbar icon: a check when saved, "!" when it failed. */
async function flash(tabId, ok, queued = false) {
  const options = tabId ? { tabId } : {}
  await chrome.action.setBadgeBackgroundColor({ ...options, color: ok ? "#596344" : "#9f2430" })
  await chrome.action.setBadgeText({ ...options, text: queued ? "…" : ok ? "✓" : "!" })
  await chrome.action.setTitle({ ...options, title: queued ? "Saved locally · waiting to sync" : ok ? "Saved to Cabinet" : "Couldn't save to Cabinet" })
  setTimeout(() => {
    chrome.action.setBadgeText({ ...options, text: "" })
    chrome.action.setTitle({ ...options, title: "Save to Cabinet" })
  }, 2500)
}

/** Saves without the popup, into the folder used last. */
async function quickSave({ url, title, tabId, fromPage = false }) {
  if (!saveableUrl(url || "")) return flash(tabId, false)
  try {
    // Only the page being viewed can be read; a saved link's metadata is fetched by Cabinet.
    const metadata = fromPage ? await pageMetadata(tabId) : {}
    const result = await saveBookmark({ url, title, folderId: await getLastFolderId(), metadata })
    await flash(tabId, true, result.queued)
  } catch (error) {
    await flash(tabId, false)
    if (error instanceof SignedOutError) await openCabinet("/login")
  }
}

/**
 * The selection with its line breaks; Chrome's own selectionText flattens them.
 * Falls back to that text where the page cannot be scripted (other-origin frames, PDFs).
 */
async function selectedText(tabId, frameId = 0, fallback = "") {
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: () => String(getSelection() ?? "") })
    return result?.result?.trim() ? result.result : fallback
  } catch {
    return fallback
  }
}

async function quickSaveHighlight({ tab, frameId, fallback }) {
  if (!tab?.id || !saveableUrl(tab.url || "")) return flash(tab?.id, false)
  try {
    const text = await selectedText(tab.id, frameId, fallback)
    const result = await saveHighlight({ text, url: tab.url, title: tab.title, folderId: await getLastFolderId() })
    await flash(tab.id, true, result.queued)
  } catch (error) {
    await flash(tab.id, false)
    if (error instanceof SignedOutError) await openCabinet("/login")
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_PAGE) {
    void quickSave({ url: info.pageUrl || tab?.url, title: tab?.title, tabId: tab?.id, fromPage: true })
  } else if (info.menuItemId === MENU_LINK) {
    // A link's own title is unknown here; Cabinet fetches it from the page.
    void quickSave({ url: info.linkUrl, title: info.selectionText || undefined, tabId: tab?.id })
  } else if (info.menuItemId === MENU_HIGHLIGHT) {
    void quickSaveHighlight({ tab, frameId: info.frameId, fallback: info.selectionText })
  }
})

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "quick-save" && command !== "save-highlight") return
  const active = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  if (!active) return
  if (command === "save-highlight") void quickSaveHighlight({ tab: active })
  else void quickSave({ url: active.url, title: active.title, tabId: active.id, fromPage: true })
})

// Shared by the popup, the options page and the background worker.
// Talks to the Cabinet API with the browser's existing Cabinet session cookie.

export const DEFAULT_SETTINGS = Object.freeze({
  apiUrl: "http://localhost:4000",
  appUrl: "http://localhost:3000",
})

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS)
  return { apiUrl: trimSlash(stored.apiUrl), appUrl: trimSlash(stored.appUrl) }
}

export function trimSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "")
}

/** Only real web pages can be saved; browser pages, files and data URLs cannot. */
export function saveableUrl(raw) {
  try {
    const url = new URL(raw)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}

/** Same normalization as the web app's duplicate check: no fragment, no trailing slash. */
export function canonicalUrl(raw) {
  const safe = saveableUrl(raw)
  if (!safe) return null
  const url = new URL(safe)
  url.hash = ""
  return url.href.replace(/\/$/, "")
}

export function cleanTags(input) {
  const list = Array.isArray(input) ? input : String(input || "").split(/[,\n]/)
  return [...new Set(list.map((tag) => String(tag).trim().replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 20)
}

export class SignedOutError extends Error {
  constructor() {
    super("Sign in to Cabinet to save pages.")
    this.name = "SignedOutError"
  }
}

export async function api(path, { method = "GET", body, signal } = {}) {
  const { apiUrl } = await getSettings()
  let response
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    })
  } catch {
    throw Object.assign(new Error("Cabinet is not reachable. Waiting to reconnect."), { retryable: true })
  }
  if (response.status === 401) throw new SignedOutError()
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : `Cabinet answered ${response.status}.`
    throw Object.assign(new Error(message), { status: response.status, retryable: response.status >= 500 || response.status === 429 || response.status === 408 })
  }
  // The API wraps every response as { success, data }.
  return payload && "data" in payload ? payload.data : payload
}

export async function getSession() {
  const { apiUrl } = await getSettings()
  try {
    const response = await fetch(`${apiUrl}/v1/auth/get-session`, { credentials: "include", signal: AbortSignal.timeout(5000) })
    if (response.status >= 500) throw new Error("Unavailable")
    if (!response.ok) {
      await chrome.storage.local.remove(`session:${apiUrl}`)
      return null
    }
    const data = await response.json()
    if (data?.user) {
      const user = { id: data.user.id, name: data.user.name }
      await chrome.storage.local.set({ [`session:${apiUrl}`]: user })
      return user
    }
    await chrome.storage.local.remove(`session:${apiUrl}`)
    return null
  } catch {
    const cached = (await chrome.storage.local.get(`session:${apiUrl}`))[`session:${apiUrl}`]
    return cached ? { ...cached, offline: true } : null
  }
}

/** Folders the user may add to: their own, or shared as Contributor or Editor. */
export async function listFolders() {
  const folders = (await api("/v1/folders")) || []
  return folders
    .filter((folder) => (folder.access ?? (folder.isOwner === false ? "CONTRIBUTOR" : "OWNER")) !== "VIEWER")
    .map((folder) => ({ id: folder.id, name: folder.name, shared: folder.isOwner === false }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listTags() {
  const tags = (await api("/v1/tags")) || []
  return tags.map((tag) => tag.name)
}

/** Finds an item already saved at this address, scanning the host's matches page by page. */
export async function findExisting(rawUrl, signal) {
  const canonical = canonicalUrl(rawUrl)
  if (!canonical) return null
  const host = new URL(canonical).hostname
  let cursor
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ search: host, limit: "100" })
    if (cursor) query.set("cursor", cursor)
    const result = await api(`/v1/bookmarks?${query}`, { signal })
    const match = (result?.data || []).find((item) => item.url && canonicalUrl(item.url) === canonical)
    if (match) return match
    cursor = result?.nextCursor
    if (!cursor) break
  }
  return null
}

/**
 * Runs inside the page (via chrome.scripting), so it must not use anything from this module.
 * Reads the same tags the API scrapes, for sites that block the API's own fetch.
 */
export function readPageMetadata() {
  const meta = (...keys) => {
    for (const key of keys) {
      const value = document.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute("content")?.trim()
      if (value) return value
    }
    return undefined
  }
  const icon = document.querySelector('link[rel~="icon"], link[rel="apple-touch-icon"]')
  const ogType = meta("og:type")?.toLowerCase()
  const contentType = ogType?.startsWith("video") || meta("og:video", "og:video:url", "og:video:secure_url") ? "VIDEO" : ogType === "article" ? "ARTICLE" : undefined
  return {
    contentType,
    description: meta("og:description", "twitter:description", "description"),
    imageUrl: meta("og:image", "og:image:url", "og:image:secure_url", "twitter:image"),
    siteName: meta("og:site_name", "application-name"),
    faviconUrl: icon?.href,
    baseUrl: document.baseURI,
  }
}

/** Keeps only usable values: http(s) addresses resolved against the page, text within the API's limits. */
export function cleanMetadata(raw) {
  const out = {}
  if (!raw || typeof raw !== "object") return out
  const text = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined)
  const link = (value) => {
    if (typeof value !== "string" || !value.trim()) return undefined
    try {
      const url = new URL(value.trim(), raw.baseUrl)
      return (url.protocol === "http:" || url.protocol === "https:") && url.href.length <= 2048 ? url.href : undefined
    } catch {
      return undefined
    }
  }
  const values = {
    contentType: ["VIDEO", "ARTICLE", "IMAGE", "SOCIAL_POST", "LINK", "UNKNOWN"].includes(raw.contentType) ? raw.contentType : undefined,
    description: text(raw.description, 1000),
    siteName: text(raw.siteName, 200),
    imageUrl: link(raw.imageUrl),
    faviconUrl: link(raw.faviconUrl),
  }
  for (const [key, value] of Object.entries(values)) if (value) out[key] = value
  return out
}

/** The open tab's own metadata, or nothing where the page cannot be scripted. */
export async function pageMetadata(tabId) {
  if (!tabId) return {}
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: readPageMetadata })
    return cleanMetadata(result?.result)
  } catch {
    return {}
  }
}

export async function saveBookmark({ url, title, folderId, tags, description, metadata = {} }) {
  const safe = saveableUrl(url)
  if (!safe) throw new Error("Only web pages (http or https) can be saved.")
  return queueSave({
      type: "BOOKMARK",
      url: safe,
      title: title?.trim() || undefined,
      description: description?.trim() || metadata.description || undefined,
      imageUrl: metadata.imageUrl,
      faviconUrl: metadata.faviconUrl,
      siteName: metadata.siteName,
      contentType: metadata.contentType,
      folderId: folderId || undefined,
      tags: cleanTags(tags),
  })
}

export const MAX_HIGHLIGHT_LENGTH = 10000

/** Paragraph text with single line breaks kept as hard breaks. */
function paragraph(text, marks) {
  const content = text.split("\n").flatMap((line, index) => [
    ...(index > 0 ? [{ type: "hardBreak" }] : []),
    ...(line ? [{ type: "text", text: line, ...(marks ? { marks } : {}) }] : []),
  ])
  return { type: "paragraph", ...(content.length ? { content } : {}) }
}

/**
 * A highlight is a Cabinet note: the selected text as a quote, then a link back to the page.
 * Blank lines in the selection separate the quote's paragraphs.
 */
export function highlightDocument({ text, url, title }) {
  const quote = String(text || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim().slice(0, MAX_HIGHLIGHT_LENGTH)
  if (!quote) throw new Error("Select some text on the page first.")
  const source = title?.trim() || new URL(url).hostname.replace(/^www\./, "")
  return {
    type: "doc",
    content: [
      { type: "blockquote", content: quote.split(/\n{2,}/).map((part) => paragraph(part.trim())) },
      paragraph(source, [{ type: "link", attrs: { href: url } }]),
    ],
  }
}

export async function saveHighlight({ text, url, title, folderId }) {
  const safe = saveableUrl(url)
  if (!safe) throw new Error("Only text on web pages (http or https) can be saved.")
  return queueSave({
      type: "NOTE",
      url: safe,
      title: title?.trim() || new URL(safe).hostname.replace(/^www\./, ""),
      noteDocument: highlightDocument({ text, url: safe, title }),
      folderId: folderId || undefined,
  })
}

let workerSave
export function setWorkerSave(save) { workerSave = save }

export async function queueSave(body) {
  const result = workerSave ? await workerSave(body) : await chrome.runtime.sendMessage({ type: "cabinet-save", body })
  if (result?.error) throw new Error(result.error)
  return result
}

export async function getOutbox() {
  return chrome.runtime.sendMessage({ type: "cabinet-outbox" })
}

export async function getLastFolderId() {
  const { lastFolderId } = await chrome.storage.local.get({ lastFolderId: "" })
  return lastFolderId
}

export async function setLastFolderId(folderId) {
  await chrome.storage.local.set({ lastFolderId: folderId || "" })
}

export async function openCabinet(path = "/cabinet") {
  const { appUrl } = await getSettings()
  await chrome.tabs.create({ url: `${appUrl}${path}` })
}

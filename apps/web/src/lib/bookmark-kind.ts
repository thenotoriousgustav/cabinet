type BookmarkLike = { url?: string | null; contentType?: string | null; type?: string | null }

function parsedUrl(url?: string | null) {
  if (!url) return null
  try {
    return new URL(url)
  } catch {
    return null
  }
}

const hostIs = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

/** Links that are themselves a video, not merely posts on a site that hosts video. */
export function isVideoBookmark(bookmark: BookmarkLike): boolean {
  if (bookmark.contentType === "VIDEO") return true
  const url = parsedUrl(bookmark.url)
  if (!url) return false
  const host = url.hostname.toLowerCase()
  if (hostIs(host, "youtube.com")) return /^\/(watch|shorts|live|embed)\b/.test(url.pathname)
  if (hostIs(host, "youtu.be") || hostIs(host, "vimeo.com")) return url.pathname.length > 1
  if (hostIs(host, "tiktok.com")) return url.pathname.includes("/video/")
  if (hostIs(host, "instagram.com")) return /^\/(reel|reels|tv)\//.test(url.pathname)
  return false
}

/** Posts the media downloader can usually extract from, including X posts that may carry video. */
export function canDownloadMedia(bookmark: BookmarkLike): boolean {
  if (isVideoBookmark(bookmark)) return true
  const url = parsedUrl(bookmark.url)
  if (!url) return false
  const host = url.hostname.toLowerCase()
  return (hostIs(host, "x.com") || hostIs(host, "twitter.com")) && /\/status\/\d+/.test(url.pathname)
}

export function isDrawingBookmark(bookmark: BookmarkLike): boolean {
  return bookmark.type === "DRAWING"
}

export function isPdfBookmark(bookmark: BookmarkLike): boolean {
  if (bookmark.contentType === "PDF") return true
  const url = parsedUrl(bookmark.url)
  return !!url && url.pathname.toLowerCase().endsWith(".pdf")
}

export function isImageBookmark(bookmark: BookmarkLike): boolean {
  if (bookmark.contentType === "IMAGE") return true
  const url = parsedUrl(bookmark.url)
  if (!url) return false
  return /\.(jpe?g|png|webp|gif|svg)$/i.test(url.pathname)
}

/** Notes, plus items without a link that are not drawings (older notes predate the type field). */
export function isNoteBookmark(bookmark: BookmarkLike): boolean {
  return bookmark.type === "NOTE" || (!bookmark.url && bookmark.type !== "DRAWING")
}

/** Items that open in Cabinet's own editor rather than on another website. */
export function editorPath(bookmark: BookmarkLike & { id: string }): string | null {
  if (isDrawingBookmark(bookmark)) return `/cabinet/drawings/${encodeURIComponent(bookmark.id)}`
  if (isNoteBookmark(bookmark)) return `/cabinet/notes/${encodeURIComponent(bookmark.id)}`
  return null
}

export type ItemAccess = "owner" | "editor" | "viewer"

/**
 * What the current user may do with an item. "editor" may change its title, description and link
 * and move it to Trash; personal fields (favorite, pin, archive, tags, folder, notes) stay with the author.
 */
export function itemAccess(bookmark: { access?: ItemAccess; canEdit?: boolean }): ItemAccess {
  return bookmark.access ?? (bookmark.canEdit === false ? "viewer" : "owner")
}

type NoteNode = { type?: string; text?: string; content?: NoteNode[] }

const nodeText = (node: NoteNode): string =>
  node.type === "hardBreak" ? "\n" : typeof node.text === "string" ? node.text : (node.content ?? []).map(nodeText).join("")

/**
 * The quoted text of a highlight saved from a web page: a note that keeps its page's address and
 * opens with a quote. Other notes, including ones that merely start with a quote, return null.
 */
export function highlightQuote(bookmark: BookmarkLike & { noteDocument?: unknown }): string | null {
  if (!isNoteBookmark(bookmark) || !parsedUrl(bookmark.url)) return null
  let document = bookmark.noteDocument
  if (typeof document === "string") {
    try {
      document = JSON.parse(document)
    } catch {
      return null
    }
  }
  const first = (document as NoteNode | null)?.content?.[0]
  if (first?.type !== "blockquote") return null
  const quote = (first.content ?? []).map(nodeText).map((part) => part.trim()).filter(Boolean).join("\n\n")
  return quote || null
}

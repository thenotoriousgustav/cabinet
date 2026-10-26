import { BadRequestException } from "@nestjs/common"
import { decodeHtmlEntities as decodeHtml } from "../providers/metadata/metadata-provider.interface"

export type ImportEntry = { kind: "folder"; title: string; parent: number | null } | { kind: "bookmark"; title: string; url: string; tags: string[]; parent: number | null }

/** Tokenize Netscape exports, including nested folders and several entries on one line. Never fetch imported URLs here. */
export function parseBookmarkImport(html: string) {
  const entries: ImportEntry[] = []
  const folders: Array<number | null> = []
  let nextFolder: number | null = null
  let skipped = 0
  const text = (value: string) => decodeHtml(value.replace(/<[^>]*>/g, "")).trim()
  const attr = (attributes: string, name: string) => attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find((value) => value !== undefined)
  for (const token of html.matchAll(/<H3\b[^>]*>([\s\S]*?)<\/H3\s*>|<A\b([^>]*)>([\s\S]*?)<\/A\s*>|<DL\b[^>]*>|<\/DL\s*>/gi)) {
    if (/^<H3\b/i.test(token[0])) {
      nextFolder = entries.length
      entries.push({ kind: "folder", title: text(token[1]).slice(0, 200) || "Imported folder", parent: folders.at(-1) ?? null })
    } else if (/^<DL\b/i.test(token[0])) { folders.push(nextFolder); nextFolder = null }
    else if (/^<\/DL/i.test(token[0])) folders.pop()
    else {
      const raw = decodeHtml(attr(token[2], "href") || "")
      let url: URL
      try { url = new URL(raw); if (!["http:", "https:"].includes(url.protocol) || raw.length > 2048) throw new Error() }
      catch { skipped++; continue }
      const tags = [...new Set(decodeHtml(attr(token[2], "tags") || "").split(",").map((tag) => tag.trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 20)
      entries.push({ kind: "bookmark", title: text(token[3]).slice(0, 1000) || url.hostname, url: url.href, tags, parent: folders.at(-1) ?? null })
    }
    if (entries.length > 10000) throw new BadRequestException("Import at most 10,000 folders and bookmarks at a time")
  }
  if (!entries.some((entry) => entry.kind === "bookmark")) throw new BadRequestException("No supported HTTP(S) bookmarks found in this HTML file")
  return { entries, skipped }
}

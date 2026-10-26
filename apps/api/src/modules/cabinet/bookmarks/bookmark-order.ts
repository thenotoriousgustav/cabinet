import { Prisma } from "@prisma/client"

export enum BookmarkSort {
  Custom = "custom",
  Relevance = "relevance",
  Newest = "newest",
  Oldest = "oldest",
  Title = "title",
  Domain = "domain",
}

export function bookmarkOrderBy(sort: BookmarkSort = BookmarkSort.Custom): Prisma.BookmarkOrderByWithRelationInput[] {
  const order: Prisma.BookmarkOrderByWithRelationInput[] = [{ isPinned: "desc" }]
  switch (sort) {
    case BookmarkSort.Custom: order.push({ position: "asc" }, { createdAt: "desc" }); break
    case BookmarkSort.Relevance:
    case BookmarkSort.Newest: order.push({ createdAt: "desc" }); break
    case BookmarkSort.Oldest: order.push({ createdAt: "asc" }); break
    case BookmarkSort.Title: order.push({ sortTitle: "asc" }); break
    case BookmarkSort.Domain: order.push({ sortDomain: { sort: "asc", nulls: "last" } }, { sortTitle: "asc" }); break
  }
  return [...order, { id: "asc" }]
}

export function bookmarkSortFields({ title, url }: { title?: string; url?: string | null }) {
  let sortDomain: string | null | undefined
  if (url !== undefined) {
    try { sortDomain = new URL(url || "").hostname.toLowerCase().replace(/^www\./, "") }
    catch { sortDomain = null }
  }
  return { sortTitle: title?.toLowerCase(), sortDomain }
}

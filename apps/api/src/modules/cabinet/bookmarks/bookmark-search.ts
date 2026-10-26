import { BadRequestException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { BookmarkSort } from "./bookmark-order"

export interface SearchFilters {
  folderId?: string; isFavorite?: boolean; isArchived?: boolean; isTrash?: boolean
  tag?: string; search?: string; cursor?: string; limit?: number; status?: string
  type?: string; contentType?: string; sort?: BookmarkSort
  domain?: string; addedAfter?: string; addedBefore?: string
}

export function searchRefinements(filters: SearchFilters) {
  for (const value of [filters.domain, filters.addedAfter, filters.addedBefore, filters.search]) {
    if (value !== undefined && typeof value !== "string") throw new BadRequestException("Search filters must be strings")
  }
  const domain = filters.domain?.trim().toLowerCase().replace(/^www\./, "")
  if (domain && !/^[a-z0-9.-]+$/.test(domain)) throw new BadRequestException("Enter a domain, not a URL")
  const date = (value?: string) => {
    if (!value) return undefined
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(new Date(value).getTime()) || new Date(value).toISOString().slice(0, 10) !== value) throw new BadRequestException("Invalid date")
    return new Date(value)
  }
  const after = date(filters.addedAfter)
  const before = date(filters.addedBefore)
  if (after && before && after > before) throw new BadRequestException("Start date must precede end date")
  return { domain, after, before: before && new Date(before.getTime() + 86400000) }
}

/** All values are SQL parameters. Personal link annotations and tags never enter shared search. */
export function bookmarkSearchQuery(userId: string, filters: SearchFilters) {
  const query = filters.search?.trim() || ""
  if (query.length > 200) throw new BadRequestException("Search is limited to 200 characters")
  if (filters.cursor && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(filters.cursor)) throw new BadRequestException("Invalid search cursor")
  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, 10)
  const { domain, after, before } = searchRefinements(filters)
  const shared = Prisma.sql`EXISTS (SELECT 1 FROM folders f WHERE f.id = b."folderId" AND f."deletedAt" IS NULL AND (f."userId" = ${userId}::uuid OR EXISTS (SELECT 1 FROM folder_members m WHERE m."folderId" = f.id AND m."userId" = ${userId}::uuid)))`
  const global = !filters.folderId && !filters.isTrash && filters.isFavorite === undefined && filters.isArchived === undefined && !filters.tag && !filters.status && !filters.type && !filters.contentType
  const access = filters.folderId && !filters.isTrash ? shared : global ? Prisma.sql`(b."userId" = ${userId}::uuid OR ${shared})` : Prisma.sql`b."userId" = ${userId}::uuid`
  const conditions = [access, filters.isTrash ? Prisma.sql`b."deletedAt" IS NOT NULL` : Prisma.sql`b."deletedAt" IS NULL`]
  if (filters.folderId) conditions.push(Prisma.sql`b."folderId" = ${filters.folderId}::uuid`)
  if (filters.type) conditions.push(Prisma.sql`b.type::text = ${filters.type}`)
  if (filters.contentType) conditions.push(Prisma.sql`b."contentType"::text = ${filters.contentType}`)
  if (filters.isFavorite !== undefined) conditions.push(Prisma.sql`b."isFavorite" = ${filters.isFavorite}`)
  if (filters.isArchived !== undefined) conditions.push(Prisma.sql`b."isArchived" = ${filters.isArchived}`)
  if (filters.status) {
    conditions.push(Prisma.sql`b.status = ${filters.status}`)
    if (["BROKEN", "REDIRECTED"].includes(filters.status)) conditions.push(Prisma.sql`b.type = 'BOOKMARK' AND b.url IS NOT NULL`)
  }
  if (filters.tag) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "_BookmarkTags" bt JOIN tags t ON t.id = bt."B" WHERE bt."A" = b.id AND t.name = ${filters.tag.trim().toLowerCase()})`)
  if (domain) conditions.push(Prisma.sql`b."sortDomain" = ${domain}`)
  if (after) conditions.push(Prisma.sql`b."createdAt" >= ${after}`)
  if (before) conditions.push(Prisma.sql`b."createdAt" < ${before}`)
  const personalNotes = Prisma.sql`CASE WHEN b."userId" = ${userId}::uuid OR b.type = 'NOTE' THEN coalesce(b.notes, '') ELSE '' END`
  const scores = terms.map((term) => {
    // strpos treats %, _ and backslashes literally, unlike an unescaped LIKE pattern.
    const exact = (field: Prisma.Sql) => Prisma.sql`strpos(lower(coalesce(${field}, '')), ${term}) > 0`
    const title = exact(Prisma.sql`b.title`)
    const fuzzy = term.length >= 4 ? Prisma.sql`word_similarity(${term}, lower(b.title)) >= 0.45` : Prisma.sql`false`
    conditions.push(Prisma.sql`(${title} OR ${exact(Prisma.sql`b.description`)} OR ${exact(Prisma.sql`b.url`)} OR ${exact(personalNotes)} OR ${fuzzy})`)
    return Prisma.sql`(CASE WHEN ${title} THEN 10 WHEN ${fuzzy} THEN 4 ELSE 0 END + CASE WHEN ${exact(Prisma.sql`b.description`)} THEN 3 ELSE 0 END + CASE WHEN ${exact(Prisma.sql`b.url`)} THEN 2 ELSE 0 END + CASE WHEN ${exact(personalNotes)} THEN 1 ELSE 0 END)`
  })
  const rank = scores.length ? Prisma.join(scores, " + ") : Prisma.sql`0`
  const sort = filters.sort
  const order = sort === BookmarkSort.Newest ? Prisma.sql`"isPinned" DESC, "createdAt" DESC, id ASC`
    : sort === BookmarkSort.Oldest ? Prisma.sql`"isPinned" DESC, "createdAt" ASC, id ASC`
    : sort === BookmarkSort.Title ? Prisma.sql`"isPinned" DESC, "sortTitle" ASC, id ASC`
    : sort === BookmarkSort.Domain ? Prisma.sql`"isPinned" DESC, "sortDomain" ASC NULLS LAST, "sortTitle" ASC, id ASC`
    : Prisma.sql`score DESC, "createdAt" DESC, id ASC`
  return Prisma.sql`WITH matched AS (
    SELECT b.id, b."createdAt", b."isPinned", b."sortTitle", b."sortDomain", (${rank}) AS score
    FROM bookmarks b WHERE ${Prisma.join(conditions, " AND ")}
  ), ranked AS (
    SELECT id, row_number() OVER (ORDER BY ${order}) AS position, count(*) OVER ()::int AS total FROM matched
  ) SELECT id, total FROM ranked
    WHERE position > ${filters.cursor ? Prisma.sql`coalesce((SELECT position FROM ranked WHERE id = ${filters.cursor}::uuid), 0)` : Prisma.sql`0`}
    ORDER BY position ${filters.limit ? Prisma.sql`LIMIT ${filters.limit + 1}` : Prisma.empty}`
}

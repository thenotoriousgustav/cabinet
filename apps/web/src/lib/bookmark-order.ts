import type { BookmarksControllerFindAllSort } from "@cabinet/api-client"

export const bookmarkSortOptions = [
  { value: "custom", label: "Custom Order (Drag & Drop)" },
  { value: "relevance", label: "Best matches" },
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "title", label: "Alphabetical (A-Z)" },
  { value: "domain", label: "Domain" },
] as const satisfies ReadonlyArray<{ value: BookmarksControllerFindAllSort; label: string }>

export type BookmarkSort = (typeof bookmarkSortOptions)[number]["value"]
export function isBookmarkSort(value: unknown): value is BookmarkSort {
  return bookmarkSortOptions.some((option) => option.value === value)
}

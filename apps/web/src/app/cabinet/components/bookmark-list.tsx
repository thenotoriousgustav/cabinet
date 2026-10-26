import React from "react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { BookmarkSimple, Trash, LinkSimple, FileText, Scribble, VideoCamera, X, FilePdf } from "@phosphor-icons/react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { CabinetFormat } from "@/lib/cabinet-url"
import { BookmarkListView } from "./bookmark-list-view"
import { BookmarkMoodboardView, MoodboardCard } from "./bookmark-moodboard-view"
import { BookmarkActionSheet } from "./bookmark-action-sheet"
import { BookmarkWebview } from "./bookmark-webview"
import { BookmarkInspector, type BookmarkInspectorHandle } from "./bookmark-inspector"
import type { DisplayPreferences } from "./display-preferences"
import { adjacentPreviewBookmark, moodboardColumnCount } from "@/lib/bookmark-view"
import { editorPath } from "@/lib/bookmark-kind"

interface BookmarkListProps {
  title?: string
  intro?: React.ReactNode
  searchQuery?: string
  onClearSearch?: () => void
  viewControls?: React.ReactNode
  onAddBookmark?: () => void
  sortableInParent?: boolean
  headerActions?: React.ReactNode
  displayPreferences: DisplayPreferences
  bookmarks: any[]
  isBookmarksLoading: boolean
  isBookmarksError?: boolean
  onRetryBookmarks?: () => void
  selectedFolderId?: string
  selectedTag?: string
  filterFavorite?: boolean
  filterArchived?: boolean
  folders: any[]
  viewMode: "list" | "moodboard"
  selectedBookmarkIds: string[]
  onToggleSelect: (id: string) => void
  onSelectTag: (tagName: string) => void
  onTogglePin?: (bookmark: any) => void
  onToggleFavorite: (bookmark: any) => void
  onToggleArchive: (bookmark: any) => void
  onEditBookmark: (bookmark: any) => void
  onDeleteBookmark: (id: string) => void
  onDuplicateBookmark: (bookmark: any) => void
  isDuplicatesView?: boolean
  duplicateGroups?: Array<{ url: string; bookmarks: any[] }>
  onCleanDuplicates?: () => void
  totalBookmarks?: number
  onReorder?: (newOrder: any[]) => void
  isTrashView?: boolean
  onRestoreBookmark?: (id: string) => void
  onPermanentDeleteBookmark?: (id: string) => void
  onEmptyTrash?: () => void
  onOpenDownload?: (bookmark: any) => void
  onUpdateBookmark?: (id: string, data: any) => Promise<any>
  formatFilter?: CabinetFormat
  onFormatFilterChange?: (format: CabinetFormat) => void
  isBrokenView?: boolean
  /** Lets the page open a preview from outside the list, such as the command menu. */
  previewBookmark?: any | null
  onPreviewBookmarkChange?: React.Dispatch<React.SetStateAction<any | null>>
}

export function BookmarkList({
  title,
  intro,
  searchQuery,
  onClearSearch,
  viewControls,
  onAddBookmark,
  sortableInParent = false,
  headerActions,
  displayPreferences,
  bookmarks,
  isBookmarksLoading,
  isBookmarksError = false,
  onRetryBookmarks,
  selectedFolderId,
  selectedTag,
  filterFavorite,
  filterArchived,
  folders,
  viewMode,
  selectedBookmarkIds,
  onToggleSelect: toggleSelect,
  onSelectTag,
  onToggleFavorite,
  onTogglePin,
  onToggleArchive,
  onEditBookmark,
  onDeleteBookmark,
  onDuplicateBookmark,
  isDuplicatesView,
  duplicateGroups,
  onCleanDuplicates,
  totalBookmarks,
  onReorder,
  isTrashView,
  onRestoreBookmark,
  onPermanentDeleteBookmark,
  onEmptyTrash,
  onOpenDownload,
  onUpdateBookmark,
  formatFilter = "all",
  onFormatFilterChange,
  isBrokenView,
  previewBookmark: controlledPreview,
  onPreviewBookmarkChange,
}: BookmarkListProps) {
  const onToggleSelect = (id: string) => {
    if (bookmarks.find((bookmark) => bookmark.id === id)?.canEdit !== false) toggleSelect(id)
  }
  const [localPreview, setLocalPreview] = React.useState<any | null>(null)
  const previewBookmark = onPreviewBookmarkChange ? controlledPreview ?? null : localPreview
  const setPreviewBookmark = onPreviewBookmarkChange ?? setLocalPreview
  const [showPreviewDetails, setShowPreviewDetails] = React.useState(true)
  const inspectorRef = React.useRef<BookmarkInspectorHandle>(null)
  const navigating = React.useRef(false)
  const navigatePreview = async (next: any | null) => {
    if (navigating.current) return
    navigating.current = true
    try {
      if (await inspectorRef.current?.flush() !== false) setPreviewBookmark(next)
    } finally { navigating.current = false }
  }
  const closeDetails = async () => {
    if (await inspectorRef.current?.flush() !== false) setShowPreviewDetails(false)
  }
  const updatePreview = async (id: string, data: any) => {
    if (!onUpdateBookmark) throw new Error('Bookmark editing is unavailable')
    const result = await onUpdateBookmark(id, data)
    const saved = result?.data?.data ?? result?.data ?? result
    setPreviewBookmark((current: any) => current?.id !== id ? current : {
      ...current, ...data,
      tags: data.tags?.map((name: string) => ({ name })) ?? current.tags,
      folder: folders.find((folder) => folder.id === data.folderId) || null,
      ...(saved?.id === id ? saved : {}),
    })
    return result
  }
  const openBookmark = (bookmark: any) => {
    if (editorPath(bookmark) || !bookmark.url) {
      onEditBookmark(bookmark)
    } else {
      setPreviewBookmark(bookmark)
    }
  }
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = React.useState(0)
  const previewBookmarks = isDuplicatesView
    ? duplicateGroups?.flatMap((group) => group.bookmarks) ?? []
    : bookmarks
  const previousBookmark = previewBookmark && adjacentPreviewBookmark(previewBookmarks, previewBookmark.id, -1)
  const nextBookmark = previewBookmark && adjacentPreviewBookmark(previewBookmarks, previewBookmark.id, 1)
  const [actionSheetBookmark, setActionSheetBookmark] = React.useState<
    any | null
  >(null)

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const activeColumnCount = moodboardColumnCount(containerWidth)

  const getHeaderTitle = () => {
    if (isTrashView) {
      return "Trash"
    }
    if (selectedFolderId) {
      const folderName = folders.find(
        (f: any) => f.id === selectedFolderId
      )?.name
      return folderName || "Loading..."
    }
    if (selectedTag) {
      return `Tag: ${selectedTag}`
    }
    if (filterFavorite) {
      return "Favorites"
    }
    if (filterArchived) {
      return "Archive"
    }
    return "All items"
  }

  const getHostname = (url: string) => {
    try {
      return new URL(url).hostname
    } catch {
      return url || ""
    }
  }

  const formatNames = { links: "links", notes: "notes", drawings: "drawings", media: "videos or media", documents: "PDF documents" } as const
  const emptyState: { title: string; description: string; action?: React.ReactNode } = searchQuery
    ? {
        title: `No results for “${searchQuery}”`,
        description: "Try another word, or press ⌘K to search your whole library.",
        action: onClearSearch && <Button variant="outline" onClick={onClearSearch}>Clear search</Button>,
      }
    : isTrashView
      ? { title: "Trash is empty", description: "Items you delete stay here until you empty the trash." }
      : isDuplicatesView
        ? { title: "No duplicates", description: "Every saved link in your library is unique." }
        : isBrokenView
          ? { title: "No broken links", description: "Every checked link is working. Use the refresh button next to Health to check again." }
          : selectedTag
            ? {
                title: `Nothing tagged #${selectedTag} here`,
                description: "Remove the tag filter to see everything in this view.",
                action: <Button variant="outline" onClick={() => onSelectTag("")}>Clear tag filter</Button>,
              }
            : formatFilter !== "all"
              ? {
                  title: `No ${formatNames[formatFilter]} here`,
                  description: "Switch back to all formats to see everything in this view.",
                  action: onFormatFilterChange && <Button variant="outline" onClick={() => onFormatFilterChange("all")}>Show all formats</Button>,
                }
              : filterFavorite
                ? { title: "No favorites yet", description: "Star an item to keep it here for quick access." }
                : filterArchived
                  ? { title: "Archive is empty", description: "Archive items you want to keep but do not need every day." }
                  : selectedFolderId
                    ? {
                        title: "This folder is empty",
                        description: "Add a bookmark here, or drag items onto this folder in the sidebar.",
                        action: onAddBookmark && <Button onClick={onAddBookmark}><BookmarkSimple data-icon="inline-start" />Add bookmark</Button>,
                      }
                    : {
                        title: "Your library is empty",
                        description: "Save your first link, or press B to add one from anywhere.",
                        action: onAddBookmark && <Button onClick={onAddBookmark}><BookmarkSimple data-icon="inline-start" />Add bookmark</Button>,
                      }

  return (
    <div ref={containerRef} className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-semibold leading-8 tracking-tight text-foreground">
              {isDuplicatesView ? "Duplicate Groups" : title || getHeaderTitle()}
            </h1>
            <p className="mt-1 break-words text-sm tabular-nums text-muted-foreground" aria-live="polite">
              {isBookmarksLoading ? "Loading your collection…" : isBookmarksError ? "Collection unavailable" : isDuplicatesView
                ? `${duplicateGroups?.length || 0} duplicate URL groups`
                : `${(totalBookmarks ?? bookmarks.length).toLocaleString()} ${(totalBookmarks ?? bookmarks.length) === 1 ? "item" : "items"}${searchQuery ? ` matching “${searchQuery}”` : ""}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isTrashView && bookmarks.length > 0 && onEmptyTrash && <Button variant="outline" size="sm" onClick={onEmptyTrash}><Trash data-icon="inline-start" />Empty Trash</Button>}
            {headerActions}
          </div>
        </div>

        {!isDuplicatesView ? (
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-0.5">
            {onFormatFilterChange && !isTrashView && (
              <ToggleGroup
                type="single"
                value={formatFilter}
                onValueChange={(val) => {
                  if (val) onFormatFilterChange(val as any)
                }}
                spacing={0}
                variant="outline"
                className="overflow-hidden rounded-md border border-border bg-card"
                aria-label="Filter by format"
              >
                <ToggleGroupItem value="all" className="h-8 px-2.5 text-xs font-medium" aria-label="All formats">
                  All
                </ToggleGroupItem>
                <ToggleGroupItem value="links" className="h-8 px-2.5 text-xs font-medium" aria-label="Links only">
                  <LinkSimple className="size-3.5" data-icon="inline-start" />
                  <span>Links</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="notes" className="h-8 px-2.5 text-xs font-medium" aria-label="Notes only">
                  <FileText className="size-3.5" data-icon="inline-start" />
                  <span>Notes</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="drawings" className="h-8 px-2.5 text-xs font-medium" aria-label="Drawings only">
                  <Scribble className="size-3.5" data-icon="inline-start" />
                  <span>Drawings</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="media" className="h-8 px-2.5 text-xs font-medium" aria-label="Media only">
                  <VideoCamera className="size-3.5" data-icon="inline-start" />
                  <span>Media</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="documents" className="h-8 px-2.5 text-xs font-medium" aria-label="PDFs and documents only">
                  <FilePdf className="size-3.5" data-icon="inline-start" />
                  <span>PDFs</span>
                </ToggleGroupItem>
              </ToggleGroup>
            )}

            <div className="flex items-center gap-2 ml-auto">
              {viewControls}
            </div>
          </div>
        ) : (
          viewControls && (
            <div className="flex justify-end pt-0.5">
              {viewControls}
            </div>
          )
        )}

        {(selectedTag || searchQuery) && (
          <div className="flex flex-wrap items-center gap-2 pt-1" aria-label="Active filters">
            <span className="text-xs text-muted-foreground">Filtered by:</span>
            {selectedTag && (
              <Badge
                variant="outline"
                className="flex items-center gap-1.5 rounded-md border-library-olive/30 bg-library-highlight px-2 py-0.5 text-xs text-library-olive"
              >
                <span>#{selectedTag}</span>
                <button
                  type="button"
                  onClick={() => onSelectTag("")}
                  className="cursor-pointer hover:opacity-80"
                  aria-label={`Clear #${selectedTag} filter`}
                  title="Clear tag filter"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            )}
            {searchQuery && (
              <Badge
                variant="outline"
                className="flex items-center gap-1.5 rounded-md border-border bg-muted/40 px-2 py-0.5 text-xs text-foreground"
              >
                <span>“{searchQuery}”</span>
                {onClearSearch && (
                  <button
                    type="button"
                    onClick={onClearSearch}
                    className="cursor-pointer hover:opacity-80"
                    aria-label="Clear search query"
                    title="Clear search"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </Badge>
            )}
          </div>
        )}
      </div>

      {intro}
      {isBookmarksLoading ? (
        <div role="status" aria-label="Loading bookmarks">
          <span className="sr-only">Loading bookmarks...</span>
          <Skeleton
            aria-hidden="true"
            className={
              viewMode === "list"
                ? "divide-y divide-border rounded-lg border border-border bg-transparent motion-reduce:animate-none"
                : "grid gap-3 bg-transparent motion-reduce:animate-none"
            }
            style={
              viewMode === "moodboard"
                ? {
                    gridTemplateColumns: `repeat(${activeColumnCount}, minmax(0, 1fr))`,
                  }
                : undefined
            }
          >
            {Array.from({ length: 6 }, (_, index) =>
              viewMode === "list" ? (
                <div key={index} className="flex h-11 items-center gap-3 px-3">
                  <div className="size-4 shrink-0 bg-muted" />
                  <div className="h-3 w-1/2 bg-muted" />
                  <div className="ml-auto hidden h-3 w-20 bg-muted sm:block" />
                  <div className="size-5 shrink-0 bg-muted" />
                </div>
              ) : (
                <div
                  key={index}
                  className="flex flex-col overflow-hidden rounded-lg border border-border"
                >
                  <div className="aspect-[4/3] bg-muted" />
                  <div className="flex flex-col gap-3 p-4">
                    <div className="h-3 w-3/4 bg-muted" />
                    <div className="h-3 w-full bg-muted" />
                    <div className="h-3 w-1/2 bg-muted" />
                  </div>
                </div>
              )
            )}
          </Skeleton>
        </div>
      ) : isBookmarksError ? (
        <Empty role="alert" className="rounded-lg border border-border bg-card p-10">
          <EmptyHeader>
            <EmptyTitle role="heading" aria-level={2}>Could not load bookmarks</EmptyTitle>
            <EmptyDescription>
              Your bookmarks could not be loaded. Please try again.
            </EmptyDescription>
          </EmptyHeader>
          {onRetryBookmarks && <Button variant="outline" onClick={onRetryBookmarks}>Try again</Button>}
        </Empty>
      ) : (isDuplicatesView ? !duplicateGroups?.length : bookmarks.length === 0) ? (
        <Empty className="rounded-lg border border-dashed border-border bg-card p-10">
          <EmptyHeader>
            <EmptyTitle role="heading" aria-level={2}>{emptyState.title}</EmptyTitle>
            <EmptyDescription>{emptyState.description}</EmptyDescription>
          </EmptyHeader>
          {emptyState.action}
        </Empty>
      ) : isDuplicatesView ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between border border-brand-border bg-brand-charcoal/5 p-3.5">
            <span className="text-sm text-foreground">
              Found {duplicateGroups?.length || 0} duplicate URL groups.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={onCleanDuplicates}
              className="hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
            >
              Auto-Clean Duplicates
            </Button>
          </div>

          {duplicateGroups?.map((group, index) => (
            <Card
              key={index}
              className="flex flex-col gap-4 p-4 shadow-none"
            >
              <div className="flex items-center justify-between border-b border-brand-border pb-2">
                <span className="max-w-xl truncate text-xs text-muted-foreground">
                  URL: {group.url}
                </span>
                <Badge
                  variant="outline"
                  className="shrink-0 border-none bg-muted text-xs"
                >
                  {group.bookmarks.length} instances
                </Badge>
              </div>
              {viewMode === "moodboard" ? (
                <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${activeColumnCount}, minmax(0, 1fr))` }}>
                  {group.bookmarks.map((bookmark) => (
                    <MoodboardCard
                      onTogglePin={onTogglePin}
                      displayPreferences={displayPreferences}
                      key={bookmark.id}
                      bookmark={bookmark}
                      folders={folders}
                      onSelectTag={onSelectTag}
                      onToggleFavorite={onToggleFavorite}
                      onToggleArchive={onToggleArchive}
                      onEditBookmark={onEditBookmark}
                      onDeleteBookmark={onDeleteBookmark}
                      onDuplicateBookmark={onDuplicateBookmark}
                      getHostname={getHostname}
                      onInspectBookmark={openBookmark}
                      hasSelectedItems={selectedBookmarkIds.length > 0}
                      isSelected={selectedBookmarkIds.includes(bookmark.id)}
                      onToggleSelect={() => onToggleSelect(bookmark.id)}
                    />
                  ))}
                </div>
              ) : (
                <BookmarkListView
                  onTogglePin={onTogglePin}
                  displayPreferences={displayPreferences}
                  bookmarks={group.bookmarks}
                  onInspectBookmark={openBookmark}
                  selectedBookmarkIds={selectedBookmarkIds}
                  onToggleSelect={onToggleSelect}
                  onSelectTag={onSelectTag}
                  onToggleFavorite={onToggleFavorite}
                  onToggleArchive={onToggleArchive}
                  onEditBookmark={onEditBookmark}
                  onDeleteBookmark={onDeleteBookmark}
                  onDuplicateBookmark={onDuplicateBookmark}
                  getHostname={getHostname}
                />
              )}
            </Card>
          ))}
        </div>
      ) : (
        <div>
          {viewMode === "list" ? (
            <BookmarkListView
              onTogglePin={onTogglePin}
              displayPreferences={displayPreferences}
              bookmarks={bookmarks}
              selectedBookmarkIds={selectedBookmarkIds}
              onToggleSelect={onToggleSelect}
              onSelectTag={onSelectTag}
              onToggleFavorite={onToggleFavorite}
              onToggleArchive={onToggleArchive}
              onEditBookmark={onEditBookmark}
              onDeleteBookmark={onDeleteBookmark}
              onDuplicateBookmark={onDuplicateBookmark}
              getHostname={getHostname}
              onReorder={onReorder}
              isTrashView={isTrashView}
              onRestoreBookmark={onRestoreBookmark}
              onPermanentDeleteBookmark={onPermanentDeleteBookmark}
              onOpenActionSheet={setActionSheetBookmark}
              onOpenDownload={onOpenDownload}
              onInspectBookmark={openBookmark}
            />
          ) : (
            <BookmarkMoodboardView
              onTogglePin={onTogglePin}
              sortableInParent={sortableInParent}
              displayPreferences={displayPreferences}
              bookmarks={bookmarks}
              folders={folders}
              activeColumnCount={activeColumnCount}
              selectedBookmarkIds={selectedBookmarkIds}
              onToggleSelect={onToggleSelect}
              onSelectTag={onSelectTag}
              onToggleFavorite={onToggleFavorite}
              onToggleArchive={onToggleArchive}
              onEditBookmark={onEditBookmark}
              onDeleteBookmark={onDeleteBookmark}
              onDuplicateBookmark={onDuplicateBookmark}
              getHostname={getHostname}
              onReorder={onReorder}
              isTrashView={isTrashView}
              onRestoreBookmark={onRestoreBookmark}
              onPermanentDeleteBookmark={onPermanentDeleteBookmark}
              onOpenActionSheet={setActionSheetBookmark}
              onOpenDownload={onOpenDownload}
              onInspectBookmark={openBookmark}
            />
          )}
        </div>
      )}

      {previewBookmark && (
        <BookmarkWebview
          key={previewBookmark.id}
          bookmark={bookmarks.find((item) => item.id === previewBookmark.id) || previewBookmark}
          onClose={() => void navigatePreview(null)}
          showDetails={showPreviewDetails}
          onToggleDetails={() => { if (showPreviewDetails) void closeDetails(); else setShowPreviewDetails(true) }}
          inspector={onUpdateBookmark ? (
            <BookmarkInspector
              ref={inspectorRef}
              key={previewBookmark.id}
              bookmark={bookmarks.find((item) => item.id === previewBookmark.id) || previewBookmark}
              folders={folders}
              onCloseWithDraft={() => setPreviewBookmark(null)}
              onUpdateBookmark={updatePreview}
              onDeleteBookmark={(id) => { setPreviewBookmark(null); onDeleteBookmark(id) }}
              onToggleFavorite={onToggleFavorite}
              onTogglePin={onTogglePin}
              onToggleArchive={onToggleArchive}
              className="h-full w-full border-0 lg:w-96 lg:shrink-0"
            />
          ) : undefined}
          onPrevious={previousBookmark ? () => void navigatePreview(previousBookmark) : undefined}
          onNext={nextBookmark ? () => void navigatePreview(nextBookmark) : undefined}
        />
      )}

      {/* Mobile Native Bottom Action Sheet for Bookmark Actions */}
      <BookmarkActionSheet
        onSelectBookmark={(bookmark) => onToggleSelect(bookmark.id)}
        onToggleFavorite={onToggleFavorite}
        onTogglePin={onTogglePin}
        open={!!actionSheetBookmark}
        onOpenChange={(open) => !open && setActionSheetBookmark(null)}
        bookmark={bookmarks.find((b) => b.id === actionSheetBookmark?.id) || actionSheetBookmark}
        onEditBookmark={onEditBookmark}
        onDuplicateBookmark={onDuplicateBookmark}
        onToggleArchive={onToggleArchive}
        onDeleteBookmark={onDeleteBookmark}
        isTrashView={isTrashView}
        onRestoreBookmark={onRestoreBookmark}
        onPermanentDeleteBookmark={onPermanentDeleteBookmark}
        onOpenDownload={onOpenDownload}
      />
    </div>
  )
}

"use client"

import { useCallback, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "@/components/ui/sonner"
import { useConfirm } from "@/hooks/use-confirm"
import { AXIOS_INSTANCE } from "@/lib/api-client"
import { useBookmarkCache } from "./use-bookmark-cache"

interface BookmarkMutationsOptions {
  updateBookmarkMutation: any
  createBookmarkMutation: any
  removeBookmarkMutation: any
  invalidateAllQueries: () => Promise<unknown> | void
  selectedBookmarkIds: string[]
  setSelectedBookmarkIds: (ids: string[]) => void
  /** Looks up a loaded bookmark so a move can be undone to its previous folder. */
  getBookmark?: (id: string) => any
}

const countLabel = (count: number) => (count === 1 ? "1 item" : `${count} items`)

export function useBookmarkMutations({
  updateBookmarkMutation,
  createBookmarkMutation,
  removeBookmarkMutation,
  invalidateAllQueries,
  selectedBookmarkIds,
  setSelectedBookmarkIds,
  getBookmark,
}: BookmarkMutationsOptions) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const pinning = useRef(new Set<string>())
  const { updateBookmarkInCache, removeBookmarkFromCache } = useBookmarkCache()

  // Reversible actions run immediately and offer Undo instead of asking first.
  const toastWithUndo = useCallback(
    (message: string, undo: () => Promise<unknown>) => {
      toast.success(message, {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await undo()
              await invalidateAllQueries()
              toast.success("Action undone")
            } catch {
              await invalidateAllQueries()
              toast.error("Could not undo. Check Trash or Archive.")
            }
          },
        },
      })
    },
    [invalidateAllQueries]
  )

  const toggleFavorite = useCallback(
    async (bookmark: any) => {
      const nextState = !bookmark.isFavorite
      updateBookmarkInCache(bookmark.id, (b) => ({
        ...b,
        isFavorite: nextState,
      }))
      try {
        await updateBookmarkMutation.mutateAsync({
          id: bookmark.id,
          data: { isFavorite: nextState },
        })
      } catch {
        updateBookmarkInCache(bookmark.id, (b) => ({
          ...b,
          isFavorite: bookmark.isFavorite,
        }))
        toast.error("Failed to update favorite status")
      }
    },
    [updateBookmarkMutation, updateBookmarkInCache]
  )

  const togglePin = useCallback(async (bookmark: any) => {
    if (pinning.current.has(bookmark.id)) return
    pinning.current.add(bookmark.id)
    try {
      await updateBookmarkMutation.mutateAsync({
        id: bookmark.id,
        data: { isPinned: !bookmark.isPinned },
      })
      // Refetch the full paginated ordering: a pinned item may come from a later page.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["infinite", "/v1/bookmarks"] }),
        queryClient.invalidateQueries({ queryKey: ["/v1/bookmarks"] }),
        queryClient.invalidateQueries({ queryKey: ["/v1/bookmarks/duplicates"] }),
      ])
      toast.success(bookmark.isPinned ? "Bookmark unpinned" : "Bookmark pinned to top")
    } catch {
      toast.error("Failed to update pin status")
    } finally {
      pinning.current.delete(bookmark.id)
    }
  }, [updateBookmarkMutation, queryClient])

  const toggleArchive = useCallback(
    async (bookmark: any) => {
      const nextState = !bookmark.isArchived
      updateBookmarkInCache(bookmark.id, (b) => ({
        ...b,
        isArchived: nextState,
      }))
      try {
        await updateBookmarkMutation.mutateAsync({
          id: bookmark.id,
          data: { isArchived: nextState },
        })
        // The item may no longer belong to the current view.
        void invalidateAllQueries()
        const undo = () =>
          updateBookmarkMutation.mutateAsync({
            id: bookmark.id,
            data: { isArchived: bookmark.isArchived },
          })
        toastWithUndo(nextState ? "Moved to Archive" : "Removed from Archive", undo)
      } catch {
        updateBookmarkInCache(bookmark.id, (b) => ({
          ...b,
          isArchived: bookmark.isArchived,
        }))
        toast.error("Failed to update archive status")
      }
    },
    [updateBookmarkMutation, updateBookmarkInCache, invalidateAllQueries, toastWithUndo]
  )

  const handleDeleteBookmark = useCallback(
    async (id: string) => {
      removeBookmarkFromCache(id)
      setSelectedBookmarkIds(selectedBookmarkIds.filter((selected) => selected !== id))
      try {
        await removeBookmarkMutation.mutateAsync({ id })
        void invalidateAllQueries()
        toastWithUndo("Moved to Trash", () =>
          AXIOS_INSTANCE.post(`/v1/bookmarks/${id}/restore`)
        )
      } catch {
        invalidateAllQueries()
        toast.error("Failed to move item to Trash")
      }
    },
    [removeBookmarkMutation, removeBookmarkFromCache, invalidateAllQueries, toastWithUndo, selectedBookmarkIds, setSelectedBookmarkIds]
  )

  const handleRestoreBookmark = useCallback(
    async (id: string) => {
      removeBookmarkFromCache(id)
      try {
        await AXIOS_INSTANCE.post(`/v1/bookmarks/${id}/restore`)
        void invalidateAllQueries()
        toast.success("Item restored")
      } catch {
        invalidateAllQueries()
        toast.error("Failed to restore bookmark")
      }
    },
    [removeBookmarkFromCache, invalidateAllQueries]
  )

  const handlePermanentDeleteBookmark = useCallback(
    async (id: string) => {
      const isConfirmed = await confirm({
        title: "Delete Permanently?",
        description:
          "This will permanently delete this bookmark. This action cannot be undone.",
        actionLabel: "Delete Permanently",
        variant: "destructive",
      })
      if (!isConfirmed) return

      removeBookmarkFromCache(id)
      try {
        await AXIOS_INSTANCE.delete(`/v1/bookmarks/${id}/permanent`)
        toast.success("Bookmark permanently deleted")
      } catch {
        invalidateAllQueries()
        toast.error("Failed to permanently delete bookmark")
      }
    },
    [confirm, removeBookmarkFromCache, invalidateAllQueries]
  )

  const handleDuplicateBookmark = useCallback(
    async (bookmark: any) => {
      try {
        await createBookmarkMutation.mutateAsync({
          data: {
            type: bookmark.type,
            noteDocument: bookmark.noteDocument || undefined,
            url: bookmark.url || undefined,
            title: bookmark.title ? `${bookmark.title} (Copy)` : undefined,
            description: bookmark.description || undefined,
            folderId: bookmark.folderId || undefined,
            tags: bookmark.tags?.map((t: any) => t.name) || [],
          },
        })
        invalidateAllQueries()
        toast.success("Bookmark duplicated")
      } catch {
        toast.error("Failed to duplicate bookmark")
      }
    },
    [createBookmarkMutation, invalidateAllQueries]
  )

  const handleEmptyTrash = useCallback(async () => {
    const isConfirmed = await confirm({
      title: "Empty Trash?",
      description:
        "Are you sure you want to permanently delete all bookmarks in Trash? This action cannot be undone.",
      actionLabel: "Empty Trash",
      variant: "destructive",
    })
    if (!isConfirmed) return
    try {
      await AXIOS_INSTANCE.delete("/v1/bookmarks/trash/empty")
      invalidateAllQueries()
      setSelectedBookmarkIds([])
      toast.success("Trash emptied")
    } catch {
      toast.error("Failed to empty trash")
    }
  }, [confirm, invalidateAllQueries, setSelectedBookmarkIds])

  const handleBulkRestore = useCallback(async () => {
    const ids = selectedBookmarkIds
    if (ids.length === 0) return
    try {
      await AXIOS_INSTANCE.post("/v1/bookmarks/bulk/restore", { ids })
      invalidateAllQueries()
      setSelectedBookmarkIds([])
      toastWithUndo(`Restored ${countLabel(ids.length)}`, () =>
        AXIOS_INSTANCE.post("/v1/bookmarks/bulk/trash", { ids })
      )
    } catch {
      toast.error("Failed to restore some items")
    }
  }, [selectedBookmarkIds, invalidateAllQueries, setSelectedBookmarkIds, toastWithUndo])

  const handleBulkTrash = useCallback(async () => {
    const ids = selectedBookmarkIds
    if (ids.length === 0) return
    ids.forEach((id) => removeBookmarkFromCache(id))
    setSelectedBookmarkIds([])
    try {
      await AXIOS_INSTANCE.post("/v1/bookmarks/bulk/trash", { ids })
      invalidateAllQueries()
      toastWithUndo(`Moved ${countLabel(ids.length)} to Trash`, () =>
        AXIOS_INSTANCE.post("/v1/bookmarks/bulk/restore", { ids })
      )
    } catch {
      invalidateAllQueries()
      toast.error("Failed to move items to Trash")
    }
  }, [selectedBookmarkIds, invalidateAllQueries, setSelectedBookmarkIds, removeBookmarkFromCache, toastWithUndo])

  const handleBulkArchive = useCallback(
    async (isArchived = true) => {
      const ids = selectedBookmarkIds
      if (ids.length === 0) return
      ids.forEach((id) => updateBookmarkInCache(id, (b) => ({ ...b, isArchived })))
      setSelectedBookmarkIds([])
      try {
        await AXIOS_INSTANCE.post("/v1/bookmarks/bulk/archive", { ids, isArchived })
        invalidateAllQueries()
        toastWithUndo(
          `${isArchived ? "Archived" : "Unarchived"} ${countLabel(ids.length)}`,
          () => AXIOS_INSTANCE.post("/v1/bookmarks/bulk/archive", { ids, isArchived: !isArchived })
        )
      } catch {
        invalidateAllQueries()
        toast.error("Failed to update archive status")
      }
    },
    [selectedBookmarkIds, updateBookmarkInCache, invalidateAllQueries, setSelectedBookmarkIds, toastWithUndo]
  )

  /** Moves items into a folder (or the root) and offers to put each one back where it was. */
  const moveBookmarks = useCallback(
    async (ids: string[], folderId: string | null, folderName?: string) => {
      if (ids.length === 0) return
      const previous = new Map<string | null, string[]>()
      for (const id of ids) {
        const from = getBookmark?.(id)?.folderId ?? null
        if (from === folderId) continue
        previous.set(from, [...(previous.get(from) ?? []), id])
      }
      if (previous.size === 0) {
        toast.info(`Already in ${folderName ? `"${folderName}"` : "this folder"}`)
        return
      }
      ids.forEach((id) => updateBookmarkInCache(id, (b) => ({ ...b, folderId })))
      setSelectedBookmarkIds([])
      try {
        await AXIOS_INSTANCE.post("/v1/bookmarks/bulk/move", { ids, folderId })
        invalidateAllQueries()
        toastWithUndo(
          `Moved ${countLabel(ids.length)} to ${folderName ? `"${folderName}"` : "Unfiled"}`,
          () =>
            Promise.all(
              [...previous].map(([from, movedIds]) =>
                AXIOS_INSTANCE.post("/v1/bookmarks/bulk/move", { ids: movedIds, folderId: from })
              )
            )
        )
      } catch {
        invalidateAllQueries()
        toast.error("Failed to move items")
      }
    },
    [getBookmark, updateBookmarkInCache, invalidateAllQueries, setSelectedBookmarkIds, toastWithUndo]
  )

  const handleBulkMove = useCallback(
    (folderId: string | null, folderName?: string) =>
      moveBookmarks(selectedBookmarkIds, folderId, folderName),
    [moveBookmarks, selectedBookmarkIds]
  )

  const handleBulkAddTags = useCallback(
    async (tagNames: string[]) => {
      const ids = selectedBookmarkIds
      if (ids.length === 0 || tagNames.length === 0) return
      try {
        await AXIOS_INSTANCE.post("/v1/bookmarks/bulk/tags", { ids, tags: tagNames })
        await invalidateAllQueries()
        toast.success(`Tagged ${countLabel(ids.length)} with #${tagNames.join(", #")}`)
      } catch {
        toast.error("Failed to add tags")
      }
    },
    [selectedBookmarkIds, invalidateAllQueries]
  )

  const handleBulkPermanentDelete = useCallback(async () => {
    if (selectedBookmarkIds.length === 0) return
    const isConfirmed = await confirm({
      title: "Permanently Delete Selected Bookmarks",
      description: `Are you sure you want to permanently delete ${selectedBookmarkIds.length} selected bookmarks? This action cannot be undone.`,
      actionLabel: "Delete Permanently",
      variant: "destructive",
    })
    if (!isConfirmed) return
    selectedBookmarkIds.forEach((id) => removeBookmarkFromCache(id))
    const idsToDelete = [...selectedBookmarkIds]
    setSelectedBookmarkIds([])
    try {
      await AXIOS_INSTANCE.post("/v1/bookmarks/bulk/permanent-delete", {
        ids: idsToDelete,
      })
      invalidateAllQueries()
      toast.success("Selected bookmarks permanently deleted")
    } catch {
      invalidateAllQueries()
      toast.error("Failed to delete some bookmarks")
    }
  }, [confirm, selectedBookmarkIds, removeBookmarkFromCache, invalidateAllQueries, setSelectedBookmarkIds])

  return {
    toggleFavorite,
    togglePin,
    toggleArchive,
    handleDeleteBookmark,
    handleRestoreBookmark,
    handlePermanentDeleteBookmark,
    handleDuplicateBookmark,
    handleEmptyTrash,
    handleBulkRestore,
    handleBulkPermanentDelete,
    handleBulkTrash,
    handleBulkArchive,
    handleBulkMove,
    handleBulkAddTags,
    moveBookmarks,
  }
}

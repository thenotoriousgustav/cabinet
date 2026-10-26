"use client"

import React, { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useForm } from "@tanstack/react-form"
import * as z from "zod"
import {
  useFoldersControllerFindAll,
  useFoldersControllerCreate,
  useFoldersControllerUpdate,
  useFoldersControllerRemove,
  useBookmarksControllerFindAllInfinite,
  useBookmarksControllerCreate,
  useBookmarksControllerUpdate,
  useBookmarksControllerRemove,
  useTagsControllerFindAll,
  useTagsControllerRemove,
  useBookmarksControllerGetHealthSummary,
  useBookmarksControllerGetDuplicates,
  useBookmarksControllerCleanDuplicates,
  useBookmarksControllerTriggerHealthCheck,
  useBookmarksControllerReorder,
} from "@/lib/api-client"
import { authClient } from "@/lib/auth-client"
import { useConfirm } from "@/hooks/use-confirm"
import { toast } from "@/components/ui/sonner"
import { WorkspaceHeader } from "@/components/workspace-header"
import { Sidebar, SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar"
import { CabinetContainer } from "@/components/cabinet-container"
import { CabinetSidebarFilters } from "./components/cabinet-sidebar-filters"
import { Toolbar, BookmarkViewControls } from "./components/toolbar"
import { GettingStarted } from "./components/getting-started"
import { useActivityOverview } from "@/lib/activity"
import { SearchQueryContext } from "./components/search-highlight"
import { ShareFolderDialog } from "./components/share-folder-dialog"
import { canAddToFolder, describeFolderAccess, folderAccess } from "@/lib/folder-roles"
import { editorPath, itemAccess } from "@/lib/bookmark-kind"
import { BookmarkList } from "./components/bookmark-list"
import { Sortable } from "@/components/ui/sortable"
import { bookmarkCollisionDetection, masonrySortingStrategy } from "@/lib/bookmark-sortable"
import { Archive, Trash, ArrowCounterClockwise, Hash as TagIcon } from "@phosphor-icons/react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select"
import {
  ActionBar,
  ActionBarSelection,
  ActionBarGroup,
  ActionBarItem,
  ActionBarSeparator,
} from "@/components/ui/action-bar"
import { MobileBottomNav, type MobileTab } from "./components/mobile-bottom-nav"
import { MobileAddBookmarkDrawer } from "./components/mobile-add-bookmark-drawer"
import { DownloadMediaDialog } from "./components/download-media-dialog"
import { CommandMenu } from "./components/command-menu"
import { BulkActionsSheet, BulkTagForm } from "./components/bulk-actions-sheet"
import { useCabinetFilters } from "./hooks/use-cabinet-filters"
import { useBookmarkMutations } from "./hooks/use-bookmark-mutations"
import { useClipboardPaste } from "./hooks/use-clipboard-paste"
import { useFinderFileDrop } from "./hooks/use-finder-file-drop"
import { FileDropOverlay } from "./components/file-drop-overlay"

const folderSchema = z.object({
  name: z
    .string()
    .min(1, "Folder name is required")
    .max(50, "Folder name must be at most 50 characters"),
  description: z.string(),
  parentId: z.string(),
})

const bookmarkSchema = z.object({
  url: z.string().trim().min(1, "Enter a link to save."),
  title: z.string(),
  description: z.string(),
  folderId: z.string(),
  tags: z.array(z.string()),
})

export const dynamic = "force-dynamic"

export function CabinetDashboard() {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    try { setOpen(localStorage.getItem("cabinet_sidebar_collapsed") !== "true") } catch {}
  }, [])
  return <SidebarProvider open={open} onOpenChange={(value) => {
    setOpen(value)
    try { localStorage.setItem("cabinet_sidebar_collapsed", String(!value)) } catch {}
  }} className="h-dvh min-h-0 overflow-hidden">
    <CabinetWorkspace />
  </SidebarProvider>
}

function CabinetWorkspace() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: session, isPending: isMeLoading } = authClient.useSession()
  const user = session?.user
  const { data: activity } = useActivityOverview(user?.id)
  const confirm = useConfirm()
  const [isLoading, setIsLoading] = useState(true)
  const [mounted, setMounted] = useState(false)

  // Fetch Folders & Tags early
  const { data: foldersData } = useFoldersControllerFindAll({
    query: { enabled: !isMeLoading && !!user },
  })
  const folders = (foldersData as any)?.data || []

  const { data: tagsData } = useTagsControllerFindAll({
    query: { enabled: !isMeLoading && !!user },
  })
  const tags = (tagsData as any)?.data || []

  // Modular filters & preferences
  const {
    selectedFolderId,
    setSelectedFolderId,
    filterFavorite,
    setFilterFavorite,
    filterArchived,
    setFilterArchived,
    selectedTag,
    setSelectedTag,
    searchQuery,
    setSearchQuery,
    searchDebounced,
    currentView, domain, setDomain, addedAfter, setAddedAfter, addedBefore, setAddedBefore,
    viewMode,
    sort,
    handleSortChange,
    filterBroken,
    setFilterBroken,
    filterDuplicates,
    setFilterDuplicates,
    filterTrash,
    setFilterTrash,
    displayPreferences,
    handleDisplayPreferencesChange,
    mobileDrawerMode,
    setMobileDrawerMode,
    filterType,
    setFilterType,
    filterContentType,
    setFilterContentType,
    formatFilter,
    handleFormatFilterChange,
    activeMobileTab,
    handleSelectMobileTab: rawHandleSelectMobileTab,
    activeFilterLabel,
    showView,
  } = useCabinetFilters(folders)

  const selectedFolder = folders.find(
    (folder: any) => folder.id === selectedFolderId
  )
  // Folders shared as view only cannot receive new or moved items.
  const writableFolders = folders.filter((folder: any) => canAddToFolder(folder))
  const canAddHere = canAddToFolder(selectedFolder)
  const addTargetFolderId = canAddHere ? selectedFolderId : undefined

  const [selectedBookmarkIds, setSelectedBookmarkIds] = useState<string[]>([])
  const [isTagPopoverOpen, setIsTagPopoverOpen] = useState(false)
  const guidedOrganization = React.useRef(false)
  const { isMobile, setOpenMobile } = useSidebar()
  const [isMobileAddOpen, setIsMobileAddOpen] = useState(false)
  const [downloadBookmark, setDownloadBookmark] = useState<any | null>(null)
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false)
  const [isBulkSheetOpen, setIsBulkSheetOpen] = useState(false)
  const [previewBookmark, setPreviewBookmark] = useState<any | null>(null)

  const handleSelectMobileTab = (tab: MobileTab) => {
    rawHandleSelectMobileTab(tab, () => {
      resetBookmarkForm()
      setIsMobileAddOpen(true)
    })
  }

  const invalidateAllQueries = React.useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["/v1/bookmarks"] }),
    queryClient.invalidateQueries({ queryKey: ["infinite", "/v1/bookmarks"] }),
    queryClient.invalidateQueries({ queryKey: ["/v1/bookmarks/health"] }),
    queryClient.invalidateQueries({ queryKey: ["/v1/bookmarks/duplicates"] }),
    queryClient.invalidateQueries({ queryKey: ["/v1/folders"] }),
    queryClient.invalidateQueries({ queryKey: ["/v1/tags"] }),
    queryClient.invalidateQueries({ queryKey: ["activity-overview"] }),
  ]), [queryClient])

  // Modals state
  const [isBookmarkModalOpen, setIsBookmarkModalOpen] = useState(false)
  const [bookmarkToEdit, setBookmarkToEdit] = useState<any | null>(null)

  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false)
  const [folderToEdit, setFolderToEdit] = useState<any | null>(null)

  // TanStack Forms
  const folderForm = useForm({
    defaultValues: {
      name: "",
      description: "",
      parentId: "",
    },
    validators: {
      onSubmit: folderSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        if (folderToEdit) {
          await updateFolderMutation.mutateAsync({
            id: folderToEdit.id,
            data: {
              name: value.name,
              description: value.description || undefined,
              parentId: value.parentId || undefined,
            },
          })
        } else {
          await createFolderMutation.mutateAsync({
            data: {
              name: value.name,
              description: value.description || undefined,
              parentId: value.parentId || undefined,
            },
          })
        }
        invalidateAllQueries()
        setIsFolderModalOpen(false)
        resetFolderForm()
      } catch {
        toast.error("Failed to save folder")
      }
    },
  })

  const bookmarkForm = useForm({
    defaultValues: {
      url: "",
      title: "",
      description: "",
      folderId: "",
      tags: [] as string[],
    },
    validators: {
      onSubmit: bookmarkSchema,
    },
    onSubmit: async ({ value }) => {
      const tagsArray = (value.tags || [])
        .map((t) => t.replace(/^#/, "").trim())
        .filter((t) => t.length > 0)

      let targetUrl: string | undefined = undefined
      if (value.url?.trim()) {
        targetUrl = value.url.trim()
        if (!/^https?:\/\//i.test(targetUrl)) {
          targetUrl = "https://" + targetUrl
        }
      }

      const toastId = toast.loading(
        bookmarkToEdit ? "Updating bookmark..." : "Saving bookmark..."
      )
      try {
        if (bookmarkToEdit) {
          await updateBookmarkMutation.mutateAsync({
            id: bookmarkToEdit.id,
            // Someone else's link in a folder you edit: only its shared content can change.
            data: itemAccess(bookmarkToEdit) === "owner"
              ? {
                  type: "BOOKMARK" as any,
                  url: targetUrl,
                  title: value.title,
                  description: value.description,
                  folderId: value.folderId || null,
                  tags: tagsArray,
                }
              : { url: targetUrl, title: value.title, description: value.description },
          })
          toast.success("Bookmark updated", {
            id: toastId,
          })
        } else {
          await createBookmarkMutation.mutateAsync({
            data: {
              type: "BOOKMARK" as any,
              url: targetUrl,
              title: value.title || undefined,
              description: value.description || undefined,
              folderId: value.folderId || undefined,
              tags: tagsArray,
            },
          })
          toast.success("Bookmark saved", {
            id: toastId,
          })
        }
        invalidateAllQueries()
        setIsBookmarkModalOpen(false)
        setIsMobileAddOpen(false)
        resetBookmarkForm()
      } catch {
        toast.error("Failed to save item", { id: toastId })
      }
    },
  })

  const reorderMutation = useBookmarksControllerReorder({
    mutation: { scope: { id: "bookmark-order" } },
  })

  const {
    data: bookmarksInfiniteData,
    isLoading: isBookmarksLoading,
    isError: isBookmarksError,
    refetch: refetchBookmarks,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching: isFetchingBookmarks,
    isFetchNextPageError,
  } = useBookmarksControllerFindAllInfinite(
    {
      folderId: filterTrash ? undefined : selectedFolderId,
      isFavorite: filterTrash ? undefined : filterFavorite,
      isArchived: filterTrash ? undefined : filterArchived,
      isTrash: filterTrash,
      tag: filterTrash ? undefined : selectedTag,
      type: filterTrash ? undefined : filterType,
      contentType: filterTrash ? undefined : (filterContentType as any),
      search: searchDebounced || undefined,
      domain: domain || undefined,
      addedAfter: addedAfter || undefined,
      addedBefore: addedBefore || undefined,
      limit: 20,
      sort,
      status: filterBroken ? "BROKEN" : undefined,
    } as any,
    {
      query: {
        enabled: !isMeLoading && !!user,
        initialPageParam: undefined,
        // Shared folders poll for collaborators' changes, but never mid-reorder.
        refetchInterval: selectedFolderId && !filterTrash && !reorderMutation.isPending ? 15000 : false,
        getNextPageParam: (lastPage: any) =>
          lastPage?.data?.nextCursor || undefined,
      },
    }
  )
  const bookmarkScrollRef = React.useRef<HTMLElement>(null)
  const loadMoreRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const root = bookmarkScrollRef.current
    const target = loadMoreRef.current
    if (!root || !target || filterDuplicates || !hasNextPage || isFetchingBookmarks || isFetchNextPageError) return

    let active = true
    const observer = new IntersectionObserver((entries) => {
      if (active && entries.some((entry) => entry.isIntersecting)) {
        active = false
        observer.disconnect()
        void fetchNextPage({ cancelRefetch: false })
      }
    }, { root, rootMargin: "0px 0px 300px 0px" })
    observer.observe(target)
    return () => {
      active = false
      observer.disconnect()
    }
  }, [mounted, isLoading, user, filterDuplicates, hasNextPage, isFetchingBookmarks, isFetchNextPageError, fetchNextPage, bookmarksInfiniteData])

  const rawBookmarks =
    bookmarksInfiniteData?.pages.flatMap(
      (page: any) => page?.data?.data || []
    ) || []
  const bookmarks = Array.from(
    new Map(rawBookmarks.map((b: any) => [b.id, b])).values()
  )

  const [optimisticOrder, setOptimisticOrder] = React.useState<string[] | null>(
    null
  )

  // Drop the optimistic order once the server's order arrives, but not from a
  // refetch that started before the reorder was saved.
  React.useEffect(() => {
    if (!reorderMutation.isPending) setOptimisticOrder(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarksInfiniteData])

  const handleReorder = React.useCallback(
    (newOrder: any[]) => {
      if (sort !== "custom" || filterTrash) return
      const newIds = newOrder.filter((b) => !b.isPinned).map((b) => b.id)
      setOptimisticOrder(newOrder.map((b) => b.id))
      reorderMutation.mutate(
        { data: { ids: newIds } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: ["infinite", "/v1/bookmarks"],
            })
            queryClient.invalidateQueries({ queryKey: ["/v1/bookmarks"] })
          },
          onError: () => {
            setOptimisticOrder(null)
            toast.error("Failed to save bookmark order")
          },
        }
      )
    },
    [reorderMutation, queryClient, sort, filterTrash]
  )

  const filteredBookmarks = React.useMemo(() => {
    if (sort !== "custom" || !optimisticOrder || optimisticOrder.length === 0) return bookmarks
    const itemMap = new Map(bookmarks.map((b: any) => [b.id, b]))
    const ordered: any[] = []
    optimisticOrder.forEach((id) => {
      if (itemMap.has(id)) {
        ordered.push(itemMap.get(id))
        itemMap.delete(id)
      }
    })
    itemMap.forEach((item) => ordered.push(item))
    return ordered
  }, [bookmarks, optimisticOrder, sort])

  // Health and Duplicates Queries
  const { data: healthSummaryData } = useBookmarksControllerGetHealthSummary({
    query: { enabled: !isMeLoading && !!user },
  })
  const healthSummary = (healthSummaryData as any)?.data || healthSummaryData

  const {
    data: duplicatesData,
    isLoading: isDuplicatesLoading,
    isError: isDuplicatesError,
    refetch: refetchDuplicates,
  } = useBookmarksControllerGetDuplicates({
    query: { enabled: !isMeLoading && !!user && !!filterDuplicates },
  })
  const duplicateGroups = (duplicatesData as any)?.data || duplicatesData || []

  // Mutations
  const createFolderMutation = useFoldersControllerCreate()
  const updateFolderMutation = useFoldersControllerUpdate()
  const removeFolderMutation = useFoldersControllerRemove()

  const createBookmarkMutation = useBookmarksControllerCreate()
  const updateBookmarkMutation = useBookmarksControllerUpdate()
  const removeBookmarkMutation = useBookmarksControllerRemove()
  const removeTagMutation = useTagsControllerRemove()

  const scanHealthMutation = useBookmarksControllerTriggerHealthCheck()
  const cleanDuplicatesMutation = useBookmarksControllerCleanDuplicates()

  // Sync mount status
  useEffect(() => {
    setMounted(true)
    if (new URLSearchParams(window.location.search).has("error")) {
      toast.error(
        "Account linking failed. Use the same verified email and try again."
      )
    }
  }, [])

  useEffect(() => {
    if (!isMeLoading) {
      if (!user) router.replace("/login")
      setIsLoading(false)
    }
  }, [user, isMeLoading, router])

  useClipboardPaste({
    createBookmarkMutation,
    invalidateAllQueries,
    selectedFolderId: addTargetFolderId,
    isModalOpen: isBookmarkModalOpen || isFolderModalOpen || isMobileAddOpen || isCommandMenuOpen,
    onEditBookmark: (bookmark) => handleEditBookmark(bookmark),
  })

  const { isDraggingOver } = useFinderFileDrop({
    enabled: !(isBookmarkModalOpen || isFolderModalOpen || isMobileAddOpen || isCommandMenuOpen),
    targetFolderId: addTargetFolderId,
    targetFolderName: canAddHere ? selectedFolder?.name : undefined,
    onUploadSuccess: invalidateAllQueries,
  })

  const {
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
  } = useBookmarkMutations({
    updateBookmarkMutation,
    createBookmarkMutation,
    removeBookmarkMutation,
    invalidateAllQueries,
    selectedBookmarkIds,
    setSelectedBookmarkIds,
    getBookmark: (id) =>
      bookmarks.find((item: any) => item.id === id) ??
      duplicateGroups.flatMap((group: any) => group.bookmarks).find((item: any) => item.id === id),
  })

  const addTagsToSelection = async (names: string[]) => {
    setIsTagPopoverOpen(false)
    await handleBulkAddTags(names)
    const overview = queryClient.getQueryData<{ onboarding: { organized: boolean } }>(["activity-overview", user?.id])
    if (guidedOrganization.current && overview?.onboarding.organized) {
      guidedOrganization.current = false
      setSelectedBookmarkIds([])
      setIsBulkSheetOpen(false)
    }
  }

  const handleLogout = async () => {
    try {
      const { error } = await authClient.signOut()
      if (error) throw new Error(error.message || "Sign-out failed")
      queryClient.clear()
      router.replace("/login")
    } catch {
      toast.error("Sign-out failed. Try again.")
    }
  }

  const handleEditFolder = (folder: any) => {
    setFolderToEdit(folder)
    folderForm.setFieldValue("name", folder.name)
    folderForm.setFieldValue("description", folder.description || "")
    folderForm.setFieldValue("parentId", folder.parentId || "")
    setIsFolderModalOpen(true)
  }

  const handleDeleteFolder = async (id: string) => {
    const isConfirmed = await confirm({
      title: "Delete Folder",
      description:
        "Are you sure you want to delete this folder? All subfolders and bookmarks inside it will be soft-deleted.",
      actionLabel: "Delete",
      variant: "destructive",
    })
    if (isConfirmed) {
      try {
        await removeFolderMutation.mutateAsync({ id })
        invalidateAllQueries()
        if (selectedFolderId === id) {
          setSelectedFolderId(undefined)
        }
      } catch {
        toast.error("Failed to delete folder")
      }
    }
  }

  const handleCreateSubfolder = (parentId: string) => {
    setFolderToEdit(null)
    folderForm.reset()
    folderForm.setFieldValue("parentId", parentId)
    setIsFolderModalOpen(true)
  }

  const handleScan = async () => {
    try {
      await scanHealthMutation.mutateAsync()
      invalidateAllQueries()
      toast.success("Link check queued", { action: { label: "View activity", onClick: () => router.push("/cabinet/activity") } })
    } catch {
      toast.error("Failed to start link status scan.")
    }
  }

  const handleCleanDuplicates = async () => {
    const confirmed = await confirm({
      title: "Clean Duplicate Bookmarks?",
      description:
        "This will automatically delete duplicate bookmark copies and keep the single oldest instance per URL.",
    })
    if (confirmed) {
      try {
        await cleanDuplicatesMutation.mutateAsync()
        invalidateAllQueries()
        toast.success("Duplicate bookmarks successfully cleaned!")
      } catch {
        toast.error("Failed to clean duplicate bookmarks.")
      }
    }
  }

  const resetFolderForm = () => {
    setFolderToEdit(null)
    folderForm.reset()
  }

  const handleEditBookmark = (bookmark: any) => {
    // Notes and drawings open in their own editors.
    const path = editorPath(bookmark)
    if (path) {
      router.push(path)
      return
    }
    setBookmarkToEdit(bookmark)
    bookmarkForm.setFieldValue("url", bookmark.url || "")
    bookmarkForm.setFieldValue("title", bookmark.title || "")
    bookmarkForm.setFieldValue("description", bookmark.description || "")
    bookmarkForm.setFieldValue("folderId", bookmark.folderId || "")
    bookmarkForm.setFieldValue(
      "tags",
      bookmark.tags?.map((t: any) => `#${t.name}`) || []
    )
    setIsBookmarkModalOpen(true)
  }

  const handleDeleteTag = async (id: string) => {
    try {
      const tagToDelete = tags.find((t: any) => t.id === id)
      await removeTagMutation.mutateAsync({ id })
      invalidateAllQueries()
      toast.success(tagToDelete ? `Deleted #${tagToDelete.name}` : "Tag deleted")
      if (tagToDelete && selectedTag === tagToDelete.name) {
        setSelectedTag(undefined)
      }
    } catch {
      toast.error("Failed to delete tag")
    }
  }

  const resetBookmarkForm = () => {
    setBookmarkToEdit(null)
    bookmarkForm.reset()
    bookmarkForm.setFieldValue("url", "")
    bookmarkForm.setFieldValue("title", "")
    bookmarkForm.setFieldValue("description", "")
    bookmarkForm.setFieldValue("folderId", addTargetFolderId || "")
    bookmarkForm.setFieldValue("tags", [])
  }

  const handleCreateNote = () => {
    resetBookmarkForm()
    const params = new URLSearchParams({ new: '1' })
    if (addTargetFolderId) params.set('folder', addTargetFolderId)
    router.push(`/cabinet/notes/${crypto.randomUUID()}?${params}`)
  }

  const handleCreateDrawing = () => {
    const params = new URLSearchParams({ new: '1' })
    if (addTargetFolderId) params.set('folder', addTargetFolderId)
    router.push(`/cabinet/drawings/${crypto.randomUUID()}?${params}`)
  }

  // Productivity Keyboard Shortcuts (Linear / Superhuman style):
  // N: new note, B: new bookmark, /: focus search, 1 & 2: switch view, ⌘B: toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      // Esc leaves selection mode unless a dialog, menu, or field handles it first.
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        selectedBookmarkIds.length > 0 &&
        !target?.closest("input, textarea, [contenteditable='true'], [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']")
      ) {
        setSelectedBookmarkIds([])
        return
      }
      if (
        !target ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable ||
        target.closest("input, textarea, [contenteditable='true'], [role='dialog'], [role='alertdialog']")
      ) {
        return
      }

      if (
        isBookmarkModalOpen ||
        isFolderModalOpen ||
        isMobileAddOpen ||
        !!downloadBookmark
      ) {
        return
      }

      // ⌘B / Ctrl+B: Toggle Sidebar

      // Do not trigger single-key actions when meta, ctrl, or alt modifier keys are pressed
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return
      }

      // N: Create New Note
      if (e.key.toLowerCase() === "n") {
        e.preventDefault()
        handleCreateNote()
        return
      }

      // D: New drawing
      if (e.key.toLowerCase() === "d") {
        e.preventDefault()
        handleCreateDrawing()
        return
      }

      // B: Add New Bookmark
      if (e.key.toLowerCase() === "b") {
        e.preventDefault()
        resetBookmarkForm()
        setIsBookmarkModalOpen(true)
        return
      }

      // /: Focus Search input
      if (e.key === "/") {
        e.preventDefault()
        const searchInput = document.getElementById("cabinet-search-input") as HTMLInputElement | null
        if (searchInput) {
          searchInput.focus()
          searchInput.select()
        }
        return
      }

    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    router,
    selectedFolderId,
    resetBookmarkForm,
    setIsBookmarkModalOpen,
    isBookmarkModalOpen,
    isFolderModalOpen,
    isMobileAddOpen,
    downloadBookmark,
    selectedBookmarkIds.length,
    // New notes and drawings land in the current folder when it accepts them.
    handleCreateNote,
    handleCreateDrawing,
  ])

  const handleToggleSelectBookmark = (id: string) => {
    setSelectedBookmarkIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleClearSelection = () => {
    setSelectedBookmarkIds([])
    setIsTagPopoverOpen(false)
    guidedOrganization.current = false
  }

  const isAllSelected =
    !hasNextPage &&
    filteredBookmarks.length > 0 &&
    filteredBookmarks.every((b: any) => b.canEdit === false || selectedBookmarkIds.includes(b.id))

  const handleSelectAll = async () => {
    if (isAllSelected) {
      setSelectedBookmarkIds([])
      return
    }

    let currentBookmarks = filteredBookmarks

    if (hasNextPage) {
      const toastId = toast.loading("Loading all items…")
      try {
        let result = await fetchNextPage()
        while (result.hasNextPage) {
          result = await result.fetchNextPage()
        }
        const allPages = result.data?.pages || []
        const loadedBookmarks = Array.from(
          new Map(
            allPages
              .flatMap((page: any) => page?.data?.data || [])
              .map((b: any) => [b.id, b])
          ).values()
        )
        currentBookmarks = loadedBookmarks
        toast.dismiss(toastId)
      } catch {
        toast.error("Failed to load all items", { id: toastId })
      }
    }

    const allIds = currentBookmarks.filter((b: any) => b.canEdit !== false).map((b: any) => b.id)
    setSelectedBookmarkIds(allIds)
  }

  const handleDropBookmarkToFolder = (folderId: string, bookmarkIds: string[]) => {
    const targetFolder = folders.find((f: any) => f.id === folderId)
    if (!canAddToFolder(targetFolder)) {
      toast.error(`You can only view "${targetFolder?.name ?? "this folder"}"`)
      return
    }
    void moveBookmarks(bookmarkIds, folderId, targetFolder?.name)
  }

  const handleOpenFromCommandMenu = (bookmark: any) => {
    const path = editorPath(bookmark)
    if (path) router.push(path)
    else if (bookmark.url) setPreviewBookmark(bookmark)
  }

  // Rendering Loader
  if (!mounted || isLoading || !user) {
    return (
      <div className="flex h-dvh w-full gap-4 bg-background p-2 md:p-3" role="status" aria-label="Loading Cabinet">
        <span className="sr-only">Loading Cabinet…</span>
        <div aria-hidden="true" className="hidden w-64 shrink-0 flex-col gap-6 rounded-lg border border-border bg-card p-4 md:flex">
          <Skeleton className="h-8 w-32" />
          <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
          <div className="flex flex-col gap-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-7 w-4/5" />)}</div>
        </div>
        <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-6 px-2 py-4 sm:px-3">
          <div className="flex items-center gap-3"><Skeleton className="size-9 shrink-0" /><Skeleton className="h-9 w-full max-w-xl" /></div>
          <div className="flex flex-col gap-2"><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-28" /></div>
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="flex h-16 items-center gap-3 px-4"><Skeleton className="size-5 shrink-0" /><Skeleton className="h-4 w-1/2" /></div>)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <Sortable
      value={filteredBookmarks}
      getItemValue={(bookmark) => bookmark.id}
      onValueChange={handleReorder}
      orientation="mixed"
      strategy={masonrySortingStrategy}
      collisionDetection={bookmarkCollisionDetection}
      onDragEnd={({ active, over }) => {
        const folderId = over?.data.current?.folderId
        if (!filterTrash && folderId) {
          const id = String(active.id)
          const ids = selectedBookmarkIds.includes(id) ? selectedBookmarkIds : [id]
          void handleDropBookmarkToFolder(folderId, ids)
        }
      }}
    >
      <Sidebar variant="floating" collapsible="offcanvas">
              <CabinetSidebarFilters
                user={user}
                onLogout={handleLogout}
                selectedFolderId={selectedFolderId}
                onSelectFolder={setSelectedFolderId}
                selectedTag={selectedTag}
                onSelectTag={setSelectedTag}
                filterFavorite={filterFavorite}
                onSelectFavorite={setFilterFavorite}
                filterArchived={filterArchived}
                onSelectArchived={setFilterArchived}
                folders={folders}
                tags={tags}
                onDeleteTag={handleDeleteTag}
                isFolderModalOpen={isFolderModalOpen}
                setIsFolderModalOpen={setIsFolderModalOpen}
                folderToEdit={folderToEdit}
                folderForm={folderForm}
                onEditFolder={handleEditFolder}
                onDeleteFolder={handleDeleteFolder}
                onCreateSubfolder={handleCreateSubfolder}
                filterBroken={filterBroken}
                onSelectBroken={(val) => {
                  setFilterBroken(val)
                  if (val) {
                    setSelectedFolderId(undefined)
                    setSelectedTag(undefined)
                    setFilterFavorite(undefined)
                    setFilterArchived(undefined)
                    setFilterDuplicates(undefined)
                    setFilterTrash(undefined)
                  }
                }}
                filterDuplicates={filterDuplicates}
                onSelectDuplicates={(val) => {
                  setFilterDuplicates(val)
                  if (val) {
                    setSelectedFolderId(undefined)
                    setSelectedTag(undefined)
                    setFilterFavorite(undefined)
                    setFilterArchived(undefined)
                    setFilterBroken(undefined)
                    setFilterTrash(undefined)
                  }
                }}
                filterTrash={filterTrash}
                onSelectTrash={(val) => {
                  setFilterTrash(val)
                  if (val) {
                    setSelectedFolderId(undefined)
                    setSelectedTag(undefined)
                    setFilterFavorite(undefined)
                    setFilterArchived(undefined)
                    setFilterBroken(undefined)
                    setFilterDuplicates(undefined)
                    setFilterType(undefined)
                    setFilterContentType(undefined)
                  }
                }}
                onSelectType={(val) => {
                  setFilterType(val)
                  if (val) {
                    setSelectedFolderId(undefined)
                    setSelectedTag(undefined)
                    setFilterFavorite(undefined)
                    setFilterArchived(undefined)
                    setFilterBroken(undefined)
                    setFilterDuplicates(undefined)
                    setFilterTrash(undefined)
                    setFilterContentType(undefined)
                  }
                }}
                onSelectContentType={(val) => {
                  setFilterContentType(val)
                  if (val) {
                    setSelectedFolderId(undefined)
                    setSelectedTag(undefined)
                    setFilterFavorite(undefined)
                    setFilterArchived(undefined)
                    setFilterBroken(undefined)
                    setFilterDuplicates(undefined)
                    setFilterTrash(undefined)
                    setFilterType(undefined)
                  }
                }}
                healthSummary={healthSummary}
                onScan={handleScan}
                resetFolderForm={resetFolderForm}
                onDropBookmarkToFolder={handleDropBookmarkToFolder}
                viewSection={isMobile ? mobileDrawerMode || "all" : "all"}
                onItemSelect={() => setOpenMobile(false)}
              />
      </Sidebar>
      <SidebarInset className="h-dvh min-h-0 min-w-0 overflow-hidden">
        <CabinetContainer>
          <WorkspaceHeader onOpenNavigation={() => setMobileDrawerMode(null)}>
            <Toolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              isBookmarkModalOpen={isBookmarkModalOpen}
              setIsBookmarkModalOpen={setIsBookmarkModalOpen}
              bookmarkToEdit={bookmarkToEdit}
              bookmarkForm={bookmarkForm}
              folders={writableFolders}
              tags={tags}
              resetBookmarkForm={resetBookmarkForm}
              onCreateDrawing={handleCreateDrawing}
              onOpenCommandMenu={() => setIsCommandMenuOpen(true)}
            />
          </WorkspaceHeader>
        </CabinetContainer>
        <div className="min-h-0 flex-1 overflow-hidden pt-2 sm:pt-4">
          <CabinetContainer className="h-full">
            <div className="flex h-full min-w-0">

            <section ref={bookmarkScrollRef} className="h-full min-w-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pr-0 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] sm:pr-1 md:pb-8">
              {/* Bookmarks Grid / List */}
              <SearchQueryContext.Provider value={searchDebounced}>
              <BookmarkList
                title={activeFilterLabel}
                intro={activity && !selectedFolderId && !selectedTag && !currentView && !searchQuery && formatFilter === "all" && !domain && !addedAfter && !addedBefore ? <GettingStarted progress={activity.onboarding}
                  onSave={() => { resetBookmarkForm(); isMobile ? setIsMobileAddOpen(true) : setIsBookmarkModalOpen(true) }}
                  onOrganize={() => {
                    const item = bookmarks.find((item: any) => item.canEdit !== false)
                    if (!item) { resetBookmarkForm(); isMobile ? setIsMobileAddOpen(true) : setIsBookmarkModalOpen(true); return }
                    guidedOrganization.current = true
                    setSelectedBookmarkIds([item.id])
                    if (isMobile) setIsBulkSheetOpen(true)
                    else setIsTagPopoverOpen(true)
                  }}
                /> : undefined}
                searchQuery={searchQuery}
                onClearSearch={() => setSearchQuery("")}
                onAddBookmark={canAddHere ? () => { resetBookmarkForm(); setIsBookmarkModalOpen(true) } : undefined}
                viewControls={<BookmarkViewControls
                  sort={searchDebounced && sort === "custom" ? "relevance" : sort}
                  onSortChange={(value) => {
                    setOptimisticOrder(null)
                    setSelectedBookmarkIds([])
                    bookmarkScrollRef.current?.scrollTo({ top: 0 })
                    handleSortChange(value)
                  }}
                  sortDisabled={!!filterDuplicates}
                  displayPreferences={displayPreferences}
                  onDisplayPreferencesChange={handleDisplayPreferencesChange}
                />}
                headerActions={selectedFolder && !filterTrash ? (
                  folderAccess(selectedFolder) === "OWNER"
                    ? <ShareFolderDialog key={selectedFolder.id} folder={selectedFolder} />
                    : <span className="text-xs text-muted-foreground">{describeFolderAccess(folderAccess(selectedFolder))}</span>
                ) : undefined}
                sortableInParent
                displayPreferences={displayPreferences}
                bookmarks={filteredBookmarks}
                isBookmarksLoading={
                  filterDuplicates ? isDuplicatesLoading : isBookmarksLoading
                }
                isBookmarksError={filterDuplicates ? isDuplicatesError : isBookmarksError && !isFetchNextPageError}
                onRetryBookmarks={() => {
                  void (filterDuplicates ? refetchDuplicates() : refetchBookmarks())
                }}
                totalBookmarks={
                  (bookmarksInfiniteData as any)?.pages?.[0]?.data
                    ?.totalCount || 0
                }
                selectedFolderId={selectedFolderId}
                selectedTag={selectedTag}
                filterFavorite={filterFavorite}
                filterArchived={filterArchived}
                formatFilter={formatFilter}
                onFormatFilterChange={handleFormatFilterChange}
                folders={folders}
                viewMode={viewMode}
                selectedBookmarkIds={selectedBookmarkIds}
                onToggleSelect={handleToggleSelectBookmark}
                onSelectTag={(tag) => {
                  setSelectedTag(tag || undefined)
                }}
                onToggleFavorite={toggleFavorite}
                onTogglePin={togglePin}
                onToggleArchive={toggleArchive}
                onEditBookmark={handleEditBookmark}
                onDeleteBookmark={handleDeleteBookmark}
                onDuplicateBookmark={handleDuplicateBookmark}
                isDuplicatesView={filterDuplicates}
                duplicateGroups={duplicateGroups}
                onCleanDuplicates={handleCleanDuplicates}
                onReorder={sort === "custom" && !searchDebounced && !domain && !addedAfter && !addedBefore && !filterTrash && !bookmarks.some((item: any) => item.canEdit === false) ? handleReorder : undefined}
                isTrashView={filterTrash}
                onRestoreBookmark={handleRestoreBookmark}
                onPermanentDeleteBookmark={handlePermanentDeleteBookmark}
                onEmptyTrash={handleEmptyTrash}
                onOpenDownload={setDownloadBookmark}
                isBrokenView={filterBroken}
                previewBookmark={previewBookmark}
                onPreviewBookmarkChange={setPreviewBookmark}
                onUpdateBookmark={async (id, data) => {
                  const result = await updateBookmarkMutation.mutateAsync({ id, data })
                  await invalidateAllQueries()
                  return result
                }}
              />
              </SearchQueryContext.Provider>

              {!filterDuplicates && hasNextPage && (
                <div ref={loadMoreRef} className="flex min-h-12 items-center justify-center py-4" aria-live="polite">
                  {isFetchingNextPage ? (
                    <span role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Spinner /> Loading more bookmarks...
                    </span>
                  ) : isFetchNextPageError ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Could not load more bookmarks.</span>
                      <Button variant="outline" size="sm" disabled={isFetchingBookmarks} onClick={() => fetchNextPage({ cancelRefetch: false })}>
                        Try again
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </section>

          </div>
        </CabinetContainer>
      </div>
      </SidebarInset>

      {/* Global Command Menu ⌘K */}
      <CommandMenu
        open={isCommandMenuOpen}
        onOpenChange={setIsCommandMenuOpen}
        folders={folders}
        tags={tags}
        bookmarks={filteredBookmarks}
        onSelectFolder={(id) => showView({ folderId: id })}
        onSelectTag={(name) => showView({ tag: name })}
        onFilterFavorite={() => showView({ view: "favorites" })}
        onFilterArchived={() => showView({ view: "archive" })}
        onFilterTrash={() => showView({ view: "trash" })}
        onFilterVideo={() => showView({ format: "media" })}
        onFilterNotes={() => showView({ format: "notes" })}
        onShowAll={() => showView()}
        onOpenBookmark={handleOpenFromCommandMenu}
        onOpenAddBookmark={() => {
          resetBookmarkForm()
          setIsBookmarkModalOpen(true)
        }}
        onOpenAddFolder={() => {
          resetFolderForm()
          setIsFolderModalOpen(true)
        }}
        onScanHealth={handleScan}
        onCreateNote={handleCreateNote}
        onCreateDrawing={handleCreateDrawing}
      />

      <ActionBar
        open={selectedBookmarkIds.length > 0}
        align="center"
        className="bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] max-w-[calc(100vw-1.5rem)] gap-1.5 rounded-lg border border-border bg-card p-1.5 shadow-sm md:bottom-6"
      >
        <ActionBarSelection className="border-none bg-transparent px-2 py-0 text-xs font-medium tabular-nums text-muted-foreground">
          {selectedBookmarkIds.length} selected
        </ActionBarSelection>
        <ActionBarSeparator />
        <ActionBarGroup className="gap-1.5">
          <ActionBarItem onClick={handleSelectAll} variant="outline" size="default">
            {isAllSelected ? "Deselect all" : "Select all"}
          </ActionBarItem>

          {isMobile ? (
            <ActionBarItem onClick={() => setIsBulkSheetOpen(true)} size="default">
              Actions
            </ActionBarItem>
          ) : filterTrash ? (
            <>
              <ActionBarItem onClick={handleBulkRestore} variant="outline" size="default">
                <ArrowCounterClockwise data-icon="inline-start" />
                Restore
              </ActionBarItem>
              <ActionBarItem onClick={handleBulkPermanentDelete} variant="destructive" size="default">
                <Trash data-icon="inline-start" />
                Delete permanently
              </ActionBarItem>
            </>
          ) : (
            <>
              <Select
                value=""
                onValueChange={(folderId) => {
                  const target = folders.find((f: any) => f.id === folderId)
                  void handleBulkMove(folderId === "__root__" ? null : folderId, target?.name)
                }}
              >
                <SelectTrigger className="h-9 w-auto gap-1" aria-label="Move selected items to folder">
                  <SelectValue placeholder="Move to folder…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="__root__">Unfiled</SelectItem>
                    {writableFolders.map((f: any) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              <Popover open={isTagPopoverOpen && selectedBookmarkIds.length > 0} onOpenChange={setIsTagPopoverOpen}>
                <PopoverTrigger asChild>
                  <ActionBarItem variant="outline" size="default">
                    <TagIcon data-icon="inline-start" />
                    Tag
                  </ActionBarItem>
                </PopoverTrigger>
                <PopoverContent align="center" className="w-64 p-3">
                  <BulkTagForm tags={tags} count={selectedBookmarkIds.length} onAddTags={addTagsToSelection} />
                </PopoverContent>
              </Popover>

              <ActionBarItem onClick={() => void handleBulkArchive(true)} variant="outline" size="default">
                <Archive data-icon="inline-start" />
                Archive
              </ActionBarItem>

              <ActionBarItem onClick={() => void handleBulkTrash()} variant="destructive" size="default">
                <Trash data-icon="inline-start" />
                Move to Trash
              </ActionBarItem>
            </>
          )}

          <ActionBarSeparator />

          <Button variant="ghost" size="default" onClick={handleClearSelection} title="Clear selection (Esc)">
            Cancel
          </Button>
        </ActionBarGroup>
      </ActionBar>

      <BulkActionsSheet
        open={isMobile && isBulkSheetOpen && selectedBookmarkIds.length > 0}
        onOpenChange={setIsBulkSheetOpen}
        count={selectedBookmarkIds.length}
        isTrashView={!!filterTrash}
        folders={writableFolders}
        onMove={(folderId, folderName) => handleBulkMove(folderId, folderName)}
        onArchive={() => handleBulkArchive(true)}
        onTrash={handleBulkTrash}
        onRestore={handleBulkRestore}
        onPermanentDelete={handleBulkPermanentDelete}
        tagForm={<BulkTagForm tags={tags} count={selectedBookmarkIds.length} onAddTags={addTagsToSelection} />}
      />

      {/* Mobile Add Bookmark Drawer */}
      <MobileAddBookmarkDrawer
        open={isMobileAddOpen}
        onOpenChange={setIsMobileAddOpen}
        bookmarkForm={bookmarkForm}
        bookmarkToEdit={bookmarkToEdit}
        folders={writableFolders}
      />

      {/* Mobile Bottom Navigation Bar */}
      <MobileBottomNav
        activeTab={activeMobileTab}
        onSelectTab={handleSelectMobileTab}
        onOpenAdd={() => {
          resetBookmarkForm()
          setIsMobileAddOpen(true)
        }}
        onCreateNote={handleCreateNote}
        onCreateDrawing={handleCreateDrawing}
        onOpenCollections={() => { setMobileDrawerMode("folders"); setOpenMobile(true) }}
        onOpenLibrary={() => { setMobileDrawerMode("library"); setOpenMobile(true) }}
        trashCount={healthSummary?.trash || 0}
      />

      {/* Download Media (Video / Audio) Dialog */}
      <DownloadMediaDialog
        bookmark={downloadBookmark}
        isOpen={!!downloadBookmark}
        onClose={() => setDownloadBookmark(null)}
      />

      {/* Drag & Drop File Upload Overlay from Finder */}
      <FileDropOverlay
        isDraggingOver={isDraggingOver}
        targetFolderName={canAddHere ? selectedFolder?.name : undefined}
      />
    </Sortable>
  )
}

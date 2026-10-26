"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import {
  defaultDisplayPreferences,
  type DisplayPreferences,
} from "../components/display-preferences"
import type { MobileTab } from "../components/mobile-bottom-nav"
import { isBookmarkSort, type BookmarkSort } from "@/lib/bookmark-order"
import { buildCabinetUrl, parseCabinetLocation, type CabinetFormat, type CabinetView } from "@/lib/cabinet-url"

function parseUrlFilters() {
  if (typeof window === "undefined") return {}
  const { folderId, tag, view, format, q, sort, domain, addedAfter, addedBefore } = parseCabinetLocation(
    window.location.pathname,
    window.location.search
  )
  return {
    folderId,
    tag,
    view,
    format,
    searchQuery: q || "",
    sort: isBookmarkSort(sort) ? sort : undefined,
    domain, addedAfter, addedBefore,
  }
}

export function useCabinetFilters(folders: any[]) {
  const initialUrl = useMemo(() => parseUrlFilters(), [])

  const [selectedFolderId, setSelectedFolderIdState] = useState<string | undefined>(
    initialUrl.folderId
  )
  const [filterFavorite, setFilterFavoriteState] = useState<boolean | undefined>(
    initialUrl.view === "favorites" ? true : undefined
  )
  const [filterArchived, setFilterArchivedState] = useState<boolean | undefined>(
    initialUrl.view === "archive" ? true : false
  )
  const [selectedTag, setSelectedTagState] = useState<string | undefined>(
    initialUrl.tag
  )
  const [searchQuery, setSearchQuery] = useState<string>(initialUrl.searchQuery || "")
  const [searchDebounced, setSearchDebounced] = useState<string>(
    initialUrl.searchQuery || ""
  )
  const [domain, setDomain] = useState(initialUrl.domain || "")
  const [addedAfter, setAddedAfter] = useState(initialUrl.addedAfter || "")
  const [addedBefore, setAddedBefore] = useState(initialUrl.addedBefore || "")
  const viewMode = "moodboard" as const
  const [sort, setSortState] = useState<BookmarkSort>(
    initialUrl.sort || (initialUrl.searchQuery ? "relevance" : "custom")
  )
  const [filterBroken, setFilterBrokenState] = useState<boolean | undefined>(
    initialUrl.view === "broken" ? true : undefined
  )
  const [filterDuplicates, setFilterDuplicatesState] = useState<boolean | undefined>(
    initialUrl.view === "duplicates" ? true : undefined
  )
  const [filterTrash, setFilterTrashState] = useState<boolean | undefined>(
    initialUrl.view === "trash" ? true : undefined
  )
  const [displayPreferences, setDisplayPreferences] =
    useState<DisplayPreferences>(defaultDisplayPreferences)
  const [mobileDrawerMode, setMobileDrawerMode] = useState<
    "folders" | "library" | null
  >(null)
  const [filterType, setFilterTypeState] = useState<
    "BOOKMARK" | "NOTE" | "DRAWING" | undefined
  >(
    initialUrl.format === "notes"
      ? "NOTE"
      : initialUrl.format === "drawings"
        ? "DRAWING"
        : initialUrl.format === "links"
          ? "BOOKMARK"
          : undefined
  )
  const [filterContentType, setFilterContentTypeState] = useState<
    string | undefined
  >(initialUrl.format === "media" ? "VIDEO" : initialUrl.format === "documents" ? "PDF" : undefined)

  const formatFilter: CabinetFormat = useMemo(() => {
    if (filterContentType === "PDF") return "documents"
    if (filterContentType === "VIDEO") return "media"
    if (filterType === "NOTE") return "notes"
    if (filterType === "DRAWING") return "drawings"
    if (filterType === "BOOKMARK") return "links"
    return "all"
  }, [filterContentType, filterType])

  const currentView = useMemo<CabinetView | undefined>(() => {
    if (filterTrash) return "trash"
    if (filterFavorite) return "favorites"
    if (filterArchived) return "archive"
    if (filterBroken) return "broken"
    if (filterDuplicates) return "duplicates"
    return undefined
  }, [
    filterTrash,
    filterFavorite,
    filterArchived,
    filterBroken,
    filterDuplicates,
  ])

  // Single source of truth: URL is derived from state in one effect, so a click
  // that calls many setters (batched into one render) writes exactly one URL.
  const committedPath = useRef<string | null>(null)
  useEffect(() => {
    const { path, url } = buildCabinetUrl({
      folderId: selectedFolderId,
      tag: selectedTag,
      view: currentView,
      format: formatFilter,
      q: searchDebounced,
      sort,
      domain, addedAfter, addedBefore,
    })
    const current = `${window.location.pathname}${window.location.search}`
    const previousPath = committedPath.current
    committedPath.current = path
    if (url === current) return
    // First render, popstate, and query-only refinements replace; navigation pushes.
    if (previousPath === null || previousPath === path) window.history.replaceState(window.history.state, "", url)
    else window.history.pushState(null, "", url)
  }, [selectedFolderId, selectedTag, currentView, formatFilter, searchDebounced, sort, domain, addedAfter, addedBefore])

  const wasSearching = useRef(!!initialUrl.searchQuery)
  const collectionSort = useRef<BookmarkSort>("custom")
  useEffect(() => {
    const searching = !!searchDebounced.trim()
    if (searching && !wasSearching.current) { collectionSort.current = sort; setSortState("relevance") }
    if (!searching && wasSearching.current) setSortState(collectionSort.current)
    wasSearching.current = searching
  }, [searchDebounced, sort])

  // Debounce search query input
  useEffect(() => {
    if (searchQuery === searchDebounced) return
    const handler = setTimeout(() => setSearchDebounced(searchQuery), 200)
    return () => clearTimeout(handler)
  }, [searchQuery, searchDebounced])

  // Browser Back / Forward (popstate) event listener
  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseUrlFilters()
      committedPath.current = buildCabinetUrl({
        folderId: parsed.folderId,
        tag: parsed.tag,
        view: parsed.view,
        format: parsed.format,
      }).path
      setSelectedFolderIdState(parsed.folderId)
      setSelectedTagState(parsed.tag)
      setSearchQuery(parsed.searchQuery || "")
      setSearchDebounced(parsed.searchQuery || "")
      wasSearching.current = !!parsed.searchQuery
      setSortState(parsed.sort || (parsed.searchQuery ? "relevance" : "custom"))
      setDomain(parsed.domain || "")
      setAddedAfter(parsed.addedAfter || "")
      setAddedBefore(parsed.addedBefore || "")

      // Apply view mode
      setFilterFavoriteState(parsed.view === "favorites" ? true : undefined)
      setFilterArchivedState(parsed.view === "archive" ? true : false)
      setFilterBrokenState(parsed.view === "broken" ? true : undefined)
      setFilterDuplicatesState(parsed.view === "duplicates" ? true : undefined)
      setFilterTrashState(parsed.view === "trash" ? true : undefined)
      setFilterTypeState(
        parsed.format === "notes"
          ? "NOTE"
          : parsed.format === "drawings"
            ? "DRAWING"
            : parsed.format === "links"
              ? "BOOKMARK"
              : undefined
      )
      setFilterContentTypeState(
        parsed.format === "media" ? "VIDEO" : parsed.format === "documents" ? "PDF" : undefined
      )
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

  // Local storage preferences on mount
  useEffect(() => {
    const savedSort = localStorage.getItem("cabinet_sort")
    if (isBookmarkSort(savedSort) && !initialUrl.sort && !initialUrl.searchQuery) {
      setSortState(savedSort)
    }

    const savedPreferences = localStorage.getItem("cabinet_display_preferences")
    if (savedPreferences) {
      try {
        const parsed = JSON.parse(savedPreferences)
        if (typeof parsed === "object" && parsed !== null) {
          setDisplayPreferences({ ...defaultDisplayPreferences, ...parsed })
        }
      } catch {
        localStorage.removeItem("cabinet_display_preferences")
      }
    }
  }, [initialUrl.sort, initialUrl.searchQuery])

  const setSelectedFolderId = useCallback(
    (id: string | undefined) => {
      setSelectedFolderIdState(id)
      if (id) {
        setSelectedTagState(undefined)
        setFilterFavoriteState(undefined)
        setFilterArchivedState(false)
        setFilterBrokenState(undefined)
        setFilterDuplicatesState(undefined)
        setFilterTrashState(undefined)
        setFilterTypeState(undefined)
        setFilterContentTypeState(undefined)
      }
    },
    []
  )

  const setSelectedTag = useCallback(
    (tag: string | undefined) => {
      setSelectedTagState(tag)
    },
    []
  )

  const setFilterFavorite = useCallback(
    (fav: boolean | undefined) => {
      setFilterFavoriteState(fav)
    },
    []
  )

  const setFilterArchived = useCallback(
    (archived: boolean | undefined) => {
      setFilterArchivedState(archived)
    },
    []
  )

  const setFilterBroken = useCallback(
    (broken: boolean | undefined) => {
      setFilterBrokenState(broken)
    },
    []
  )

  const setFilterDuplicates = useCallback(
    (duplicates: boolean | undefined) => {
      setFilterDuplicatesState(duplicates)
    },
    []
  )

  const setFilterTrash = useCallback(
    (trash: boolean | undefined) => {
      setFilterTrashState(trash)
    },
    []
  )

  const setFilterType = useCallback(
    (type: "BOOKMARK" | "NOTE" | "DRAWING" | undefined) => {
      setFilterTypeState(type)
    },
    []
  )

  const setFilterContentType = useCallback(
    (ct: string | undefined) => {
      setFilterContentTypeState(ct)
    },
    []
  )

  const handleFormatFilterChange = useCallback(
    (format: CabinetFormat) => {
      const nextType = format === "links" ? "BOOKMARK" : format === "notes" ? "NOTE" : format === "drawings" ? "DRAWING" : undefined
      const nextContentType = format === "media" ? "VIDEO" : format === "documents" ? "PDF" : undefined
      setFilterTypeState(nextType)
      setFilterContentTypeState(nextContentType)
    },
    []
  )

  const handleSortChange = useCallback(
    (value: BookmarkSort) => {
      setSortState(value)
      try {
        if (!searchQuery.trim()) localStorage.setItem("cabinet_sort", value)
      } catch {}
    },
    [searchQuery]
  )

  const handleDisplayPreferencesChange = useCallback(
    (prefs: DisplayPreferences) => {
      setDisplayPreferences(prefs)
      try {
        localStorage.setItem(
          "cabinet_display_preferences",
          JSON.stringify(prefs)
        )
      } catch {}
    },
    []
  )

  const activeMobileTab = useMemo<MobileTab>(() => {
    if (filterFavorite) return "favorites"
    if (selectedFolderId) return "folders"
    if (filterTrash || filterBroken || filterDuplicates || filterArchived)
      return "library"
    return "all"
  }, [
    filterFavorite,
    selectedFolderId,
    filterTrash,
    filterBroken,
    filterDuplicates,
    filterArchived,
  ])

  /** Switches to one primary location and clears every filter that does not belong to it. */
  const showView = useCallback(
    (next: { folderId?: string; tag?: string; view?: CabinetView; format?: CabinetFormat } = {}) => {
      setSelectedFolderIdState(next.folderId)
      setSelectedTagState(next.tag)
      setFilterFavoriteState(next.view === "favorites" ? true : undefined)
      setFilterArchivedState(next.view === "archive" ? true : next.view === "trash" ? undefined : false)
      setFilterBrokenState(next.view === "broken" ? true : undefined)
      setFilterDuplicatesState(next.view === "duplicates" ? true : undefined)
      setFilterTrashState(next.view === "trash" ? true : undefined)
      setFilterTypeState(next.format === "notes" ? "NOTE" : next.format === "drawings" ? "DRAWING" : next.format === "links" ? "BOOKMARK" : undefined)
      setFilterContentTypeState(next.format === "media" ? "VIDEO" : next.format === "documents" ? "PDF" : undefined)
    },
    []
  )

  const handleSelectMobileTab = useCallback(
    (tab: MobileTab, onAdd?: () => void) => {
      if (tab === "all") showView()
      else if (tab === "favorites") showView({ view: "favorites" })
      else if (tab === "folders") setMobileDrawerMode("folders")
      else if (tab === "library") setMobileDrawerMode("library")
      else if (tab === "add") onAdd?.()
    },
    [showView]
  )

  // The primary location names the page; format and tag stay visible as refinements below it.
  const activeFilterLabel = useMemo(() => {
    if (filterTrash) return "Trash"
    if (selectedFolderId) {
      const folder = folders.find((f: any) => f.id === selectedFolderId)
      return folder ? folder.name : "Folder"
    }
    if (filterFavorite) return "Favorites"
    if (filterArchived) return "Archive"
    if (filterBroken) return "Broken links"
    if (filterDuplicates) return "Duplicates"
    if (selectedTag) return `#${selectedTag}`
    if (filterType === "NOTE") return "Notes"
    if (filterType === "DRAWING") return "Drawings"
    if (filterType === "BOOKMARK") return "Links"
    if (filterContentType === "PDF") return "PDFs & documents"
    if (filterContentType === "VIDEO") return "Videos & media"
    return "All items"
  }, [
    filterTrash,
    filterType,
    filterContentType,
    selectedFolderId,
    selectedTag,
    filterFavorite,
    filterArchived,
    filterBroken,
    filterDuplicates,
    folders,
  ])

  const resetAllFilters = useCallback(() => {
    setSelectedFolderId(undefined)
    setSelectedTag(undefined)
    setFilterFavorite(undefined)
    setFilterArchived(false)
    setFilterBroken(undefined)
    setFilterDuplicates(undefined)
    setFilterTrash(undefined)
    setFilterType(undefined)
    setFilterContentType(undefined)
    setSearchQuery("")
    setSearchDebounced("")
    setDomain("")
    setAddedAfter("")
    setAddedBefore("")
  }, [setSelectedFolderId, setSelectedTag, setFilterFavorite, setFilterArchived, setFilterBroken, setFilterDuplicates, setFilterTrash, setFilterType, setFilterContentType])

  return {
    currentView,
    domain, setDomain, addedAfter, setAddedAfter, addedBefore, setAddedBefore,
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
    setDisplayPreferences,
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
    handleSelectMobileTab,
    activeFilterLabel,
    resetAllFilters,
    showView,
  }
}

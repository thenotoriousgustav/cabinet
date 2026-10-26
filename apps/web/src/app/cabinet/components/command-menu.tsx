"use client"

import * as React from "react"
import { MagnifyingGlass, FolderSimple, Hash as Tag, Plus, Scribble, Star, Archive, Trash, VideoCamera, FileText, ArrowsClockwise, SidebarSimple } from "@phosphor-icons/react"
import { CommandDialog, CommandInput, CommandList, CommandGroup, CommandItem, CommandShortcut, CommandSeparator } from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { safeHttpUrl } from "@/lib/shared-collection"
import { useBookmarkSearch } from "../hooks/use-bookmark-search"
import { editorPath, isDrawingBookmark } from "@/lib/bookmark-kind"

interface CommandMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: any[]
  tags: any[]
  bookmarks: any[]
  onSelectFolder: (id: string | undefined) => void
  onSelectTag: (name: string | undefined) => void
  onFilterFavorite: () => void
  onFilterArchived: () => void
  onFilterTrash: () => void
  onFilterVideo: () => void
  onFilterNotes: () => void
  onShowAll: () => void
  /** Opens a saved item the same way clicking its card does. */
  onOpenBookmark: (bookmark: any) => void
  onOpenAddBookmark: () => void
  onOpenAddFolder: () => void
  onScanHealth: () => void
  onCreateNote: () => void
  onCreateDrawing: () => void
}

type Action = { label: string; icon: typeof Plus; run: () => void; shortcut?: string }

export function CommandMenu(props: CommandMenuProps) {
  const { toggleSidebar } = useSidebar()
  const [search, setSearch] = React.useState('')
  const query = useBookmarkSearch(search, props.open)
  const searching = !!search.trim()
  const waiting = searching && (query.isDebouncing || query.isPending)
  const matches = (label: string) => search.trim().toLowerCase().split(/\s+/).every((word) => label.toLowerCase().includes(word))
  const mod = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+'
  React.useEffect(() => { if (!props.open) setSearch('') }, [props.open])
  React.useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        props.onOpenChange(!props.open)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [props.open, props.onOpenChange])

  const actions: Action[] = [
    { label: 'Add bookmark', icon: Plus, run: props.onOpenAddBookmark, shortcut: 'B' },
    { label: 'Create note', icon: FileText, run: props.onCreateNote, shortcut: 'N' },
    { label: 'New drawing', icon: Scribble, run: props.onCreateDrawing, shortcut: 'D' },
    { label: 'Create new folder', icon: FolderSimple, run: props.onOpenAddFolder },
    { label: 'Check broken links & duplicates', icon: ArrowsClockwise, run: props.onScanHealth },
  ]
  const views: Action[] = [
    { label: 'All items', icon: FolderSimple, run: props.onShowAll },
    { label: 'Favorites', icon: Star, run: props.onFilterFavorite },
    { label: 'Notes', icon: FileText, run: props.onFilterNotes },
    { label: 'Videos & media', icon: VideoCamera, run: props.onFilterVideo },
    { label: 'Archive', icon: Archive, run: props.onFilterArchived },
    { label: 'Trash', icon: Trash, run: props.onFilterTrash },
    { label: 'Toggle sidebar', icon: SidebarSimple, run: toggleSidebar, shortcut: `${mod}B` },
  ]
  const folders = props.folders.filter((folder) => matches(`folder ${folder.name}`))
  const tags = props.tags.filter((tag) => matches(`tag #${tag.name}`))
  const groups = [ ['Actions', actions.filter((item) => matches(item.label))], ['Views & Filters', views.filter((item) => matches(item.label))] ] as const
  const items = searching ? (query.isDebouncing ? [] : query.items) : props.bookmarks.slice(0, 10)
  const select = (run: () => void) => { props.onOpenChange(false); run() }

  return <CommandDialog open={props.open} onOpenChange={props.onOpenChange} title="Cabinet Command Menu" description="Search your entire library, jump to folders, or run quick actions" commandProps={{ shouldFilter: false }}>
    <CommandInput value={search} onValueChange={setSearch} aria-label="Search commands and bookmarks" placeholder="Search your entire library or run a command…" />
    <CommandList className="max-h-[55dvh]">
      {groups.map(([heading, actions]) => actions.length > 0 && <CommandGroup key={heading} heading={heading}>
        {actions.map(({ label, icon: Icon, run, shortcut }) => <CommandItem key={label} value={`action ${label}`} onSelect={() => select(run)}>
          <Icon /><span>{label}</span>{shortcut && <CommandShortcut><kbd className="rounded-sm border px-1.5 font-sans">{shortcut}</kbd></CommandShortcut>}
        </CommandItem>)}
      </CommandGroup>)}
      {folders.length > 0 && <CommandGroup heading="Folders">{folders.map((folder) => <CommandItem key={folder.id} value={`folder ${folder.id}`} onSelect={() => select(() => props.onSelectFolder(folder.id))}><FolderSimple /><span>{folder.name}</span></CommandItem>)}</CommandGroup>}
      {tags.length > 0 && <CommandGroup heading="Tags">{tags.map((tag) => <CommandItem key={tag.id} value={`tag ${tag.id}`} onSelect={() => select(() => props.onSelectTag(tag.name))}><Tag /><span>{tag.name}</span></CommandItem>)}</CommandGroup>}
      {waiting && <p role="status" className="px-3 py-4 text-sm text-muted-foreground">Searching your library…</p>}
      {searching && query.isError && !query.isDebouncing && <div role="alert" className="px-3 py-3 text-sm">Could not search your library. <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry search</Button></div>}
      {items.length > 0 && <><CommandSeparator /><CommandGroup heading={searching ? 'Across your library' : 'In this view'}>
        {items.map((bookmark) => {
          const safe = safeHttpUrl(bookmark.url || '')
          const inCabinet = !!editorPath(bookmark)
          return <CommandItem key={bookmark.id} value={`bookmark ${bookmark.id}`} disabled={!safe && !inCabinet} onSelect={() => select(() => props.onOpenBookmark(bookmark))}>
            {isDrawingBookmark(bookmark) ? <Scribble /> : inCabinet ? <FileText /> : <MagnifyingGlass />}<span className="truncate">{bookmark.title || safe?.hostname || 'Untitled'}</span>
            {safe && <span className="ml-auto max-w-40 shrink-0 truncate text-xs text-muted-foreground">{safe.hostname.replace(/^www\./, '')}</span>}
          </CommandItem>
        })}
      </CommandGroup></>}
      {searching && !waiting && !query.isError && items.length === 0 && folders.length === 0 && tags.length === 0 && groups.every(([, actions]) => actions.length === 0) && <p role="status" className="px-3 py-4 text-sm text-muted-foreground">No matching results.</p>}
      {searching && !waiting && query.hasNextPage && <Button variant="ghost" className="w-full" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading more…' : query.isFetchNextPageError ? 'Retry more results' : 'More results'}</Button>}
    </CommandList>
    <p className="border-t px-3 py-2 text-xs text-muted-foreground">{searching ? 'Your saved links and notes, including Archive. Trash is excluded.' : 'Type to search beyond this view. / focuses library search.'}</p>
  </CommandDialog>
}

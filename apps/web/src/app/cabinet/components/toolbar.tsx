"use client"

import React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
import { SortAscending, MagnifyingGlass, Plus, CaretDown, BookmarkSimple, FileText, Scribble, X, Sliders, Command, UploadSimple } from "@phosphor-icons/react"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { bookmarkSortOptions, isBookmarkSort, type BookmarkSort } from "@/lib/bookmark-order"
import { defaultDisplayPreferences, densityOptions, isDensity, type DisplayPreferences } from "./display-preferences"
import { BookmarkDialog } from "./bookmark-dialog"
import { UploadFileDialog } from "./upload-file-dialog"

interface ViewControlsProps {
  sort?: BookmarkSort
  onSortChange?: (sort: BookmarkSort) => void
  sortDisabled?: boolean
  displayPreferences?: DisplayPreferences
  onDisplayPreferencesChange?: (preferences: DisplayPreferences) => void
}

export function BookmarkViewControls({
  sort = "custom", onSortChange, sortDisabled = false,
  displayPreferences = defaultDisplayPreferences, onDisplayPreferencesChange,
}: ViewControlsProps) {
  return (
    <div className="flex items-center gap-2" aria-label="Collection display controls">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-11 sm:h-9" disabled={sortDisabled} aria-label="Sort bookmarks">
            <SortAscending data-icon="inline-start" />
            <span className="lg:hidden">Sort</span><span className="hidden lg:inline">{sort === "custom" ? "Custom order" : bookmarkSortOptions.find((option) => option.value === sort)?.label}</span>
            <CaretDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup value={sort} onValueChange={(value) => { if (isBookmarkSort(value)) onSortChange?.(value) }}>
            {bookmarkSortOptions.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>


      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-11 sm:h-9" aria-label="Display options"><Sliders data-icon="inline-start" /><span>Display</span></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Density</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={displayPreferences.density} onValueChange={(value) => { if (isDensity(value)) onDisplayPreferencesChange?.({ ...displayPreferences, density: value }) }}>
              {densityOptions.filter((option) => option.value !== "comfortable").map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Visible details</DropdownMenuLabel>
            {([ ["showImage", "Preview image"], ["showTitle", "Title"], ["showDescription", "Description"], ["showWebsite", "Website"], ["showFolder", "Folder"], ["showDate", "Date added"] ] as const).map(([key, label]) => (
              <DropdownMenuCheckboxItem key={key} checked={displayPreferences[key]} onSelect={(event) => event.preventDefault()} onCheckedChange={(checked) => onDisplayPreferencesChange?.({ ...displayPreferences, [key]: checked })}>{label}</DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

interface ToolbarProps {
  searchQuery: string
  onSearchChange: (value: string) => void
  isBookmarkModalOpen: boolean
  setIsBookmarkModalOpen: (open: boolean) => void
  isUploadModalOpen?: boolean
  setIsUploadModalOpen?: (open: boolean) => void
  bookmarkToEdit: any
  bookmarkForm: any
  folders: any[]
  tags?: any[]
  resetBookmarkForm: () => void
  onOpenCommandMenu?: () => void
  onCreateDrawing?: () => void
}

export function Toolbar({ searchQuery, onSearchChange, isBookmarkModalOpen, setIsBookmarkModalOpen, isUploadModalOpen, setIsUploadModalOpen, bookmarkToEdit, bookmarkForm, folders, tags = [], resetBookmarkForm, onOpenCommandMenu, onCreateDrawing }: ToolbarProps) {
  const router = useRouter()
  const [localUploadOpen, setLocalUploadOpen] = React.useState(false)
  const isUploadOpen = isUploadModalOpen ?? localUploadOpen
  const setUploadOpen = setIsUploadModalOpen ?? setLocalUploadOpen

  const handleCreate = (type: "BOOKMARK" | "NOTE") => {
    resetBookmarkForm()
    if (type === "NOTE") {
      setIsBookmarkModalOpen(false)
      const params = new URLSearchParams({ new: "1" })
      if (bookmarkForm.state.values.folderId) params.set("folder", bookmarkForm.state.values.folderId)
      router.push(`/cabinet/notes/${crypto.randomUUID()}?${params}`)
      return
    }
    setIsBookmarkModalOpen(true)
  }

  return (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <InputGroup className="h-11 min-w-0 flex-1 rounded-md bg-card shadow-none sm:h-9 sm:max-w-xl">
        <InputGroupInput id="cabinet-search-input" type="search" aria-label="Search bookmarks" placeholder="Search your library…" value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} className="text-base md:text-sm" />
        <InputGroupAddon align="inline-start"><MagnifyingGlass /></InputGroupAddon>
        <InputGroupAddon align="inline-end">
          {searchQuery ? <Button type="button" variant="ghost" size="icon-xs" aria-label="Clear search" onClick={() => onSearchChange("")}><X /></Button> : <kbd className="hidden rounded-sm border bg-background px-1.5 text-xs text-muted-foreground sm:block" title="Focus search (/)">/</kbd>}
        </InputGroupAddon>
      </InputGroup>
      <div className="hidden shrink-0 items-center gap-3 sm:flex">
        {onOpenCommandMenu && <Button variant="ghost" size="icon" onClick={onOpenCommandMenu} aria-label="Open command menu" title="Command menu (⌘K)"><Command /></Button>}
        <ButtonGroup aria-label="Add to Cabinet">
          <Button onClick={() => handleCreate("BOOKMARK")}><Plus data-icon="inline-start" /> Add bookmark</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button className="border-l border-primary-foreground/20" size="icon-lg" aria-label="Choose what to add"><CaretDown /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44"><DropdownMenuGroup>
              <DropdownMenuItem className="whitespace-nowrap" onSelect={() => handleCreate("BOOKMARK")}><BookmarkSimple /> Add bookmark</DropdownMenuItem>
              <DropdownMenuItem className="whitespace-nowrap" onSelect={() => handleCreate("NOTE")}><FileText /> Create note</DropdownMenuItem>
              {onCreateDrawing && <DropdownMenuItem className="whitespace-nowrap" onSelect={onCreateDrawing}><Scribble /> New drawing</DropdownMenuItem>}
              <DropdownMenuItem className="whitespace-nowrap" onSelect={() => setUploadOpen(true)}><UploadSimple /> Upload file</DropdownMenuItem>
            </DropdownMenuGroup></DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      </div>
      <BookmarkDialog isOpen={isBookmarkModalOpen} onOpenChange={setIsBookmarkModalOpen} bookmarkToEdit={bookmarkToEdit} bookmarkForm={bookmarkForm} folders={folders} tags={tags} onClose={() => setIsBookmarkModalOpen(false)} />
      <UploadFileDialog isOpen={isUploadOpen} onOpenChange={setUploadOpen} folders={folders} selectedFolderId={bookmarkForm?.state?.values?.folderId} />
    </div>
  )
}

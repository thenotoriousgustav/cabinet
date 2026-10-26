import React from "react"
import { useDroppable } from "@dnd-kit/core"
import { FolderSimple, PencilSimple, Trash, Plus } from "@phosphor-icons/react"
import { SidebarItemActionsButton } from "./sidebar-item-actions"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/ui/sidebar"
import { canAddToFolder } from "@/lib/folder-roles"

function FolderDropTarget({ folderId, disabled, className, ...props }: React.ComponentProps<"div"> & {
  folderId: string
  disabled: boolean
}) {
  const instanceId = React.useId()
  const { setNodeRef, isOver } = useDroppable({
    id: `folder:${folderId}:${instanceId}`,
    data: { type: "folder", folderId },
    disabled,
  })
  return <div {...props} ref={setNodeRef} data-folder-drop={folderId} className={cn(
    className,
    isOver && "bg-primary text-primary-foreground ring-2 ring-primary/40",
  )} />
}

interface FolderTreeProps {
  folders: any[]
  selectedFolderId?: string
  onSelectFolder: (id: string) => void
  onEditFolder: (folder: any) => void
  onDeleteFolder: (id: string) => void
  onCreateSubfolder?: (parentId: string) => void
  onDropBookmarkToFolder?: (folderId: string, bookmarkIds: string[]) => void
  parentId?: string | null
  depth?: number
}

function FolderActions({ folder, onEditFolder, onDeleteFolder, onCreateSubfolder }: {
  folder: any
  onEditFolder: (folder: any) => void
  onDeleteFolder: (id: string) => void
  onCreateSubfolder?: (parentId: string) => void
}) {
  const { isMobile } = useSidebar()
  if (folder.isOwner === false) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarItemActionsButton
          label={`Actions for ${folder.name}`}
          className="md:group-hover/folder:opacity-100 md:group-focus-within/folder:opacity-100"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={isMobile ? "bottom" : "right"} className="w-44">
        <DropdownMenuGroup>
          {onCreateSubfolder && (
            <DropdownMenuItem onSelect={() => onCreateSubfolder(folder.id)}>
              <Plus />New subfolder
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => onEditFolder(folder)}>
            <PencilSimple />Rename or edit
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onDeleteFolder(folder.id)}>
          <Trash />Delete folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function FolderTree({
  folders,
  selectedFolderId,
  onSelectFolder,
  onEditFolder,
  onDeleteFolder,
  onCreateSubfolder,
  onDropBookmarkToFolder,
  parentId = null,
  depth = 0,
}: FolderTreeProps) {
  const [dragOverFolderId, setDragOverFolderId] = React.useState<string | null>(null)
  const list = folders.filter((f: any) => f.parentId === parentId)
  if (list.length === 0) return null

  const handleDragOver = (e: React.DragEvent, folderId: string) => {
    if (!canAddToFolder(folders.find((f: any) => f.id === folderId))) return
    if (e.dataTransfer.types.includes("application/json") || e.dataTransfer.types.includes("text/plain")) {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = "move"
      setDragOverFolderId(folderId)
    }
  }

  const handleDragLeave = (e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (dragOverFolderId === folderId) setDragOverFolderId(null)
  }

  const handleDrop = (e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolderId(null)
    try {
      const rawData = e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain")
      if (rawData) {
        const parsed = JSON.parse(rawData)
        const ids = Array.isArray(parsed) ? parsed : parsed.bookmarkIds || [parsed.id]
        if (ids && ids.length > 0) onDropBookmarkToFolder?.(folderId, ids)
      }
    } catch (err) {
      console.error("Drop failed parsing data:", err)
    }
  }

  const renderRow = (folder: any, toggle?: React.ReactNode) => {
    const isSelected = selectedFolderId === folder.id
    return (
      <FolderDropTarget
        folderId={folder.id}
        disabled={!onDropBookmarkToFolder || !canAddToFolder(folder)}
        onDragOver={(e) => handleDragOver(e, folder.id)}
        onDragLeave={(e) => handleDragLeave(e, folder.id)}
        onDrop={(e) => handleDrop(e, folder.id)}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={cn(
          "group/folder flex w-full items-center justify-between gap-1 rounded-md pr-1 text-left text-sm transition-colors",
          dragOverFolderId === folder.id
            ? "bg-primary pl-3 font-semibold text-primary-foreground ring-2 ring-primary/40"
            : isSelected
              ? "bg-foreground/10 font-semibold text-foreground"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        )}
      >
        <button
          type="button"
          aria-current={isSelected ? "page" : undefined}
          onClick={() => onSelectFolder(folder.id)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring md:min-h-8"
        >
          <FolderSimple className="size-3.5 shrink-0" />
          <span className="truncate">{folder.name}</span>
        </button>
        <FolderActions
          folder={folder}
          onEditFolder={onEditFolder}
          onDeleteFolder={onDeleteFolder}
          onCreateSubfolder={onCreateSubfolder}
        />
        {toggle}
      </FolderDropTarget>
    )
  }

  return (
    <Accordion type="multiple" className="flex flex-col gap-0.5">
      {list.map((folder: any) => {
        const hasChildren = folders.some((f: any) => f.parentId === folder.id)
        if (!hasChildren) return <div key={folder.id}>{renderRow(folder)}</div>

        return (
          <AccordionItem key={folder.id} value={folder.id} className="border-none">
            {renderRow(
              folder,
              <AccordionTrigger
                aria-label={`Show subfolders of ${folder.name}`}
                className="flex size-9 shrink-0 items-center justify-center p-0 after:hidden hover:bg-foreground/5 hover:no-underline md:size-6"
                onClick={(e) => e.stopPropagation()}
              />
            )}
            <AccordionContent className="pt-0.5 pb-0">
              <FolderTree
                folders={folders}
                selectedFolderId={selectedFolderId}
                onSelectFolder={onSelectFolder}
                onEditFolder={onEditFolder}
                onDeleteFolder={onDeleteFolder}
                onCreateSubfolder={onCreateSubfolder}
                onDropBookmarkToFolder={onDropBookmarkToFolder}
                parentId={folder.id}
                depth={depth + 1}
              />
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </Accordion>
  )
}

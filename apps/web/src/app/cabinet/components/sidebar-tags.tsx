"use client"

import React from "react"
import Link from "next/link"
import { Gear, MagnifyingGlass, PencilSimple, Plus, Hash as TagIcon, Trash } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { useConfirm } from "@/hooks/use-confirm"
import {
  SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { RenameTagDialog } from "./rename-tag-dialog"
import { SidebarItemActionsButton } from "./sidebar-item-actions"
import { SIDEBAR_TAG_LIMIT, visibleSidebarTags } from "@/lib/tag-list"

interface SidebarTagsProps {
  tags: any[]
  selectedTag?: string
  onSelectTag: (tag: string | undefined) => void
  onCreateTag: () => void
  onDeleteTag: (id: string) => void
  onItemSelect?: () => void
}

export function SidebarTags({ tags, selectedTag, onSelectTag, onCreateTag, onDeleteTag, onItemSelect }: SidebarTagsProps) {
  const confirm = useConfirm()
  const { isMobile } = useSidebar()
  const [tagToRename, setTagToRename] = React.useState<any | null>(null)
  const [allOpen, setAllOpen] = React.useState(false)

  const select = (name: string) => {
    onSelectTag(selectedTag === name ? undefined : name)
    onItemSelect?.()
  }

  const confirmDelete = async (tag: any) => {
    const count = tag.bookmarkCount ?? 0
    const confirmed = await confirm({
      title: `Delete #${tag.name}?`,
      description: count > 0
        ? `The tag is removed from ${count === 1 ? "1 item" : `${count} items`}. The items themselves are kept.`
        : "No items use this tag.",
      actionLabel: "Delete tag",
      variant: "destructive",
    })
    if (confirmed) onDeleteTag(tag.id)
  }

  const visible = visibleSidebarTags(tags, selectedTag)
  const hiddenCount = tags.length - visible.length

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Tags</SidebarGroupLabel>
      <SidebarGroupAction title="Create tag" aria-label="Create tag" onClick={onCreateTag}>
        <Plus />
      </SidebarGroupAction>
      <SidebarGroupContent>
        <SidebarMenu>
          {tags.length === 0 ? (
            <span className="px-2 text-xs text-muted-foreground">No tags yet</span>
          ) : (
            visible.map((tag: any) => {
              const isSelected = selectedTag === tag.name
              return (
                <SidebarMenuItem key={tag.id}>
                  <SidebarMenuButton
                    isActive={isSelected}
                    aria-current={isSelected ? "page" : undefined}
                    tooltip={tag.name}
                    className="data-[active=false]:text-muted-foreground"
                    onClick={() => select(tag.name)}
                  >
                    <TagIcon className="size-4" />
                    <span>{tag.name}</span>
                  </SidebarMenuButton>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarItemActionsButton
                        label={`Actions for #${tag.name}`}
                        // data-sidebar keeps the menu button's right padding clear of this trigger.
                        data-sidebar="menu-action"
                        className="absolute top-1/2 right-1 -translate-y-1/2 md:group-hover/menu-item:opacity-100 md:group-focus-within/menu-item:opacity-100"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side={isMobile ? "bottom" : "right"} className="w-44">
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={() => setTagToRename(tag)}>
                          <PencilSimple />Rename
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => void confirmDelete(tag)}>
                        <Trash />Delete tag
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              )
            })
          )}
          {tags.length > SIDEBAR_TAG_LIMIT && (
            <SidebarMenuItem>
              <Popover open={allOpen} onOpenChange={setAllOpen}>
                <PopoverTrigger asChild>
                  <SidebarMenuButton className="text-muted-foreground">
                    <MagnifyingGlass className="size-4" />
                    <span>{hiddenCount > 0 ? `Show all ${tags.length} tags` : "Search tags"}</span>
                  </SidebarMenuButton>
                </PopoverTrigger>
                <PopoverContent side={isMobile ? "bottom" : "right"} align="end" sideOffset={12} className="w-64 overflow-hidden p-0">
                  <Command>
                    <CommandInput placeholder="Search tags…" aria-label="Search tags" />
                    <CommandList className="max-h-72">
                      <CommandEmpty>No matching tags.</CommandEmpty>
                      {tags.map((tag: any) => (
                        <CommandItem
                          key={tag.id}
                          value={tag.name}
                          aria-current={selectedTag === tag.name ? "true" : undefined}
                          onSelect={() => { setAllOpen(false); select(tag.name) }}
                          className={cn(selectedTag === tag.name && "font-medium text-foreground")}
                        >
                          <TagIcon className="text-muted-foreground" />
                          <span className="min-w-0 truncate">{tag.name}</span>
                          {/* The shortcut slot keeps the count flush right and replaces the check mark. */}
                          <CommandShortcut className="pl-3 tabular-nums">{tag.bookmarkCount ?? 0}</CommandShortcut>
                        </CommandItem>
                      ))}
                    </CommandList>
                  </Command>
                  <Link
                    href="/cabinet/settings?tab=tags"
                    className="flex min-h-10 items-center gap-2 border-t border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Gear className="size-3.5" />Manage tags
                  </Link>
                </PopoverContent>
              </Popover>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
      <RenameTagDialog
        tag={tagToRename}
        onOpenChange={(open) => { if (!open) setTagToRename(null) }}
        onRenamed={(oldName, newName) => { if (selectedTag === oldName) onSelectTag(newName) }}
      />
    </SidebarGroup>
  )
}

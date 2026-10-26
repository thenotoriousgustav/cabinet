import React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"
import { authClient } from "@/lib/auth-client"
import { useForm } from "@tanstack/react-form"
import { useQueryClient } from "@tanstack/react-query"
import * as z from "zod"
import { FolderDialog } from "./folder-dialog"
import { TagDialog } from "./tag-dialog"
import {
  BookmarkSimple,
  Star,
  Archive,
  FolderPlus,
  Trash,
  Gear,
  PlugsConnected,
  CaretUpDown,
  Sun,
  Moon,
  Desktop,
  SignOut,
} from "@phosphor-icons/react"
import { AXIOS_INSTANCE } from "@/lib/api-client"
import { toast } from "@/components/ui/sonner"
import { FolderTree } from "./folder-tree"
import {
  SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupLabel, SidebarGroupAction, SidebarGroupContent,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuBadge,
  SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar"
import { CabinetBrand } from "@/components/cabinet-brand"
import { SidebarTags } from "./sidebar-tags"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"

interface SidebarFiltersProps {
  user?: any
  onLogout?: () => void
  selectedFolderId?: string
  onSelectFolder: (id: string | undefined) => void
  selectedTag?: string
  onSelectTag: (tag: string | undefined) => void
  filterFavorite?: boolean
  onSelectFavorite: (fav: boolean | undefined) => void
  filterArchived?: boolean
  onSelectArchived: (arch: boolean | undefined) => void
  folders: any[]
  tags: any[]
  onDeleteTag: (id: string) => void
  onCreateTag?: (name: string) => Promise<void>
  isFolderModalOpen: boolean
  setIsFolderModalOpen: (open: boolean) => void
  folderToEdit: any
  folderForm: any
  onEditFolder: (folder: any) => void
  onDeleteFolder: (id: string) => void
  onCreateSubfolder?: (parentId: string) => void
  filterBroken?: boolean
  onSelectBroken: (broken: boolean | undefined) => void
  filterDuplicates?: boolean
  onSelectDuplicates: (dup: boolean | undefined) => void
  filterTrash?: boolean
  onSelectTrash?: (trash: boolean | undefined) => void
  onSelectType?: (type: "BOOKMARK" | "NOTE" | "DRAWING" | undefined) => void
  onSelectContentType?: (type: string | undefined) => void
  healthSummary?: any
  onScan?: () => void
  resetFolderForm: () => void
  onItemSelect?: () => void
  viewSection?: "all" | "folders" | "library"
  onDropBookmarkToFolder?: (folderId: string, bookmarkIds: string[]) => void
}

function WorkspaceSidebarGroup({ title, action, children, menu = false }: { title: string; action?: React.ReactNode; children: React.ReactNode; menu?: boolean }) {
  return <SidebarGroup>
    <SidebarGroupLabel>{title}</SidebarGroupLabel>
    {action && <SidebarGroupAction asChild>{action}</SidebarGroupAction>}
    <SidebarGroupContent>{menu ? <SidebarMenu>{children}</SidebarMenu> : children}</SidebarGroupContent>
  </SidebarGroup>
}

function WorkspaceSidebarItem({ icon, label, badge, ...props }: React.ComponentProps<typeof SidebarMenuButton> & { icon: React.ReactNode; label: string; badge?: React.ReactNode }) {
  return <SidebarMenuItem>
    <SidebarMenuButton {...props} aria-current={props.isActive ? "page" : undefined} tooltip={label} className="pr-8 data-[active=false]:text-muted-foreground">{icon}<span>{label}</span></SidebarMenuButton>
    {badge != null && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
  </SidebarMenuItem>
}

const tagSchema = z.object({
  name: z
    .string()
    .min(1, "Tag name is required")
    .max(30, "Tag name must be at most 30 characters"),
})

export function CabinetSidebarFilters({
  user: userProp,
  onLogout: onLogoutProp,
  selectedFolderId,
  onSelectFolder,
  selectedTag,
  onSelectTag,
  filterFavorite,
  onSelectFavorite,
  filterArchived,
  onSelectArchived,
  folders,
  tags,
  onDeleteTag,
  onCreateTag,
  isFolderModalOpen,
  setIsFolderModalOpen,
  folderToEdit,
  folderForm,
  onEditFolder,
  onDeleteFolder,
  onCreateSubfolder,
  filterBroken,
  onSelectBroken,
  filterDuplicates,
  onSelectDuplicates,
  filterTrash,
  onSelectTrash,
  onSelectType,
  onSelectContentType,
  healthSummary,
  onScan,
  resetFolderForm,
  onItemSelect,
  viewSection = "all",
  onDropBookmarkToFolder,
}: SidebarFiltersProps) {
  const router = useRouter()
  const { isMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
  const { data: session } = authClient.useSession()
  const currentUser = userProp !== undefined ? userProp : session?.user

  const handleLogout = async () => {
    if (onLogoutProp) {
      onLogoutProp()
      return
    }
    try {
      const { error } = await authClient.signOut()
      if (error) throw new Error(error.message || "Sign-out failed")
      queryClient.clear()
      toast.success("Logged out successfully")
      router.replace("/login")
    } catch {
      toast.error("Sign-out failed. Try again.")
    }
  }

  const queryClient = useQueryClient()
  const [isTagModalOpen, setIsTagModalOpen] = React.useState(false)
  const [isCreatingTag, setIsCreatingTag] = React.useState(false)

  const tagForm = useForm({
    defaultValues: {
      name: "",
    },
    validators: {
      onSubmit: tagSchema,
    },
    onSubmit: async ({ value }) => {
      const cleanName = value.name.replace(/^#/, "").trim()
      if (!cleanName) return
      setIsCreatingTag(true)
      try {
        if (onCreateTag) {
          await onCreateTag(cleanName)
        } else {
          await AXIOS_INSTANCE.post("/v1/tags", { name: cleanName })
        }
        await queryClient.invalidateQueries({ queryKey: ["/v1/tags"] })
        tagForm.reset()
        setIsTagModalOpen(false)
        toast.success(`Tag #${cleanName} created!`)
      } catch {
        toast.error("Failed to create tag")
      } finally {
        setIsCreatingTag(false)
      }
    },
  })

  return (
    <nav data-bookmark-sidebar aria-label="Library navigation" className="flex h-full min-h-0 w-full flex-col">
      <SidebarHeader className="flex min-h-16 flex-row items-center justify-between px-4 py-3">
        <CabinetBrand />
        <SidebarTrigger className="size-11 shrink-0 md:hidden" />
      </SidebarHeader>
      <SidebarContent className="gap-4 px-2 pb-4">
      {/* Quick Filters / Library Group */}
      {viewSection !== "folders" && (
        <>
          <WorkspaceSidebarGroup title="Library" menu>
            <WorkspaceSidebarItem
              icon={<BookmarkSimple className="h-3.5 w-3.5" />}
              label="All items"
              isActive={
                selectedFolderId === undefined &&
                filterFavorite === undefined &&
                filterArchived === false &&
                selectedTag === undefined &&
                filterBroken === undefined &&
                filterDuplicates === undefined &&
                filterTrash === undefined
              }
              onClick={() => {
                onSelectFolder(undefined)
                onSelectTag(undefined)
                onSelectFavorite(undefined)
                onSelectArchived(false)
                onSelectBroken(undefined)
                onSelectDuplicates(undefined)
                onSelectTrash?.(undefined)
                onSelectType?.(undefined)
                onSelectContentType?.(undefined)
                onItemSelect?.()
              }}
            />

            <WorkspaceSidebarItem
              icon={<Star className="size-4" />}
              label="Favorites"
              isActive={filterFavorite === true}
              onClick={() => {
                onSelectFolder(undefined)
                onSelectTag(undefined)
                onSelectFavorite(true)
                onSelectArchived(false)
                onSelectBroken(undefined)
                onSelectDuplicates(undefined)
                onSelectTrash?.(undefined)
                onSelectType?.(undefined)
                onSelectContentType?.(undefined)
                onItemSelect?.()
              }}
            />

            <WorkspaceSidebarItem
              icon={<Archive className="h-3.5 w-3.5" />}
              label="Archive"
              isActive={filterArchived === true}
              onClick={() => {
                onSelectFolder(undefined)
                onSelectTag(undefined)
                onSelectFavorite(undefined)
                onSelectArchived(true)
                onSelectBroken(undefined)
                onSelectDuplicates(undefined)
                onSelectTrash?.(undefined)
                onSelectType?.(undefined)
                onSelectContentType?.(undefined)
                onItemSelect?.()
              }}
            />

            <WorkspaceSidebarItem
              icon={<Trash className="h-3.5 w-3.5" />}
              label="Trash"
              badge={healthSummary?.trash || undefined}
              isActive={filterTrash === true}
              onClick={() => {
                onSelectFolder(undefined)
                onSelectTag(undefined)
                onSelectFavorite(undefined)
                onSelectArchived(undefined)
                onSelectBroken(undefined)
                onSelectDuplicates(undefined)
                onSelectTrash?.(true)
                onSelectType?.(undefined)
                onSelectContentType?.(undefined)
                onItemSelect?.()
              }}
            />
          </WorkspaceSidebarGroup>
        </>
      )}

      {/* Folders Group */}
      {viewSection !== "library" && (
        <>
          <WorkspaceSidebarGroup
            title="Folders"
            action={
              <button
                type="button"
                onClick={() => {
                  resetFolderForm()
                  setIsFolderModalOpen(true)
                }}
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                title="Create folder"
                aria-label="Create folder"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            }
          >
            <FolderTree
              folders={folders}
              selectedFolderId={selectedFolderId}
              onSelectFolder={(id) => {
                onSelectFolder(id)
                onSelectTag(undefined)
                onSelectFavorite(undefined)
                onSelectArchived(undefined)
                onSelectBroken(undefined)
                onSelectDuplicates(undefined)
                onSelectTrash?.(undefined)
                onItemSelect?.()
              }}
              onEditFolder={onEditFolder}
              onDeleteFolder={onDeleteFolder}
              onCreateSubfolder={onCreateSubfolder}
              onDropBookmarkToFolder={onDropBookmarkToFolder}
            />
          </WorkspaceSidebarGroup>

          {/* Folder Form Dialog */}
          <FolderDialog
            isOpen={isFolderModalOpen}
            onOpenChange={setIsFolderModalOpen}
            folderToEdit={folderToEdit}
            folderForm={folderForm}
            folders={folders}
            onClose={() => setIsFolderModalOpen(false)}
          />

          <SidebarTags
            tags={tags}
            selectedTag={selectedTag}
            onSelectTag={onSelectTag}
            onCreateTag={() => {
              tagForm.reset()
              setIsTagModalOpen(true)
            }}
            onDeleteTag={onDeleteTag}
            onItemSelect={onItemSelect}
          />


          {/* New tag dialog */}
          <TagDialog
            isOpen={isTagModalOpen}
            onOpenChange={setIsTagModalOpen}
            tagForm={tagForm}
            isCreatingTag={isCreatingTag}
            onClose={() => setIsTagModalOpen(false)}
          />
        </>
      )}
      </SidebarContent>

      {/* User Account & Settings Footer */}
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu><SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              type="button"
              size="lg"
              className="group/user flex min-h-14 w-full items-center justify-between gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="User account and settings"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary font-medium text-foreground">
                  {currentUser?.name?.[0]?.toUpperCase() ||
                    currentUser?.email?.[0]?.toUpperCase() ||
                    "U"}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium leading-5 text-foreground">
                    {currentUser?.name || "Cabinet User"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {currentUser?.email || "Signed in"}
                  </span>
                </div>
              </div>
              <CaretUpDown className="size-3.5 shrink-0 text-brand-muted group-hover/user:text-brand-charcoal" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "top" : "right"}
            align="end"
            sideOffset={8}
            className="w-56"
          >
            <DropdownMenuGroup>
              <div className="border-b border-border px-3 py-2">
                <p className="truncate text-xs font-semibold text-foreground">
                  {currentUser?.name || "Cabinet User"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {currentUser?.email}
                </p>
              </div>

              <DropdownMenuItem asChild>
                <Link
                  href="/cabinet/settings"
                  className="flex cursor-pointer items-center gap-2 text-xs"
                >
                  <Gear className="size-3.5" />
                  <span>Settings</span>
                </Link>
              </DropdownMenuItem>

              <DropdownMenuItem asChild>
                <Link
                  href="/cabinet/integrations"
                  className="flex cursor-pointer items-center gap-2 text-xs"
                >
                  <PlugsConnected className="size-3.5" />
                  <span>Integrations &amp; Import</span>
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="flex cursor-pointer items-center gap-2 text-xs">
                  {theme === "dark" ? (
                    <Moon className="size-3.5" />
                  ) : theme === "light" ? (
                    <Sun className="size-3.5" />
                  ) : (
                    <Desktop className="size-3.5" />
                  )}
                  <span>Theme</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-36">
                  <DropdownMenuRadioGroup
                    value={theme}
                    onValueChange={setTheme}
                  >
                    <DropdownMenuRadioItem value="light" className="text-xs">
                      <Sun className="mr-2 size-3.5" /> Light
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark" className="text-xs">
                      <Moon className="mr-2 size-3.5" /> Dark
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system" className="text-xs">
                      <Desktop className="mr-2 size-3.5" /> System
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                variant="destructive"
                onSelect={handleLogout}
                className="flex cursor-pointer items-center gap-2 text-xs"
              >
                <SignOut className="size-3.5" />
                <span>Sign out</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        </SidebarMenuItem></SidebarMenu>
      </SidebarFooter>
    </nav>
  )
}

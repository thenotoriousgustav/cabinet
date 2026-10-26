"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "@tanstack/react-form"
import * as z from "zod"
import { toast } from "@/components/ui/sonner"
import { useConfirm } from "@/hooks/use-confirm"
import { editorPath, itemAccess } from "@/lib/bookmark-kind"

export const folderSchema = z.object({
  name: z
    .string()
    .min(1, "Folder name is required")
    .max(50, "Folder name must be at most 50 characters"),
  description: z.string(),
  parentId: z.string(),
})

export const bookmarkSchema = z.object({
  url: z.string().trim().min(1, "Enter a link to save."),
  title: z.string(),
  description: z.string(),
  folderId: z.string(),
  tags: z.array(z.string()),
})

interface UseCabinetFormsOptions {
  updateFolderMutation: any
  createFolderMutation: any
  removeFolderMutation: any
  updateBookmarkMutation: any
  createBookmarkMutation: any
  invalidateAllQueries: () => Promise<unknown> | void
  selectedFolderId?: string
  setSelectedFolderId: (id: string | undefined) => void
  addTargetFolderId?: string
  setIsMobileAddOpen: (open: boolean) => void
}

export function useCabinetForms({
  updateFolderMutation,
  createFolderMutation,
  removeFolderMutation,
  updateBookmarkMutation,
  createBookmarkMutation,
  invalidateAllQueries,
  selectedFolderId,
  setSelectedFolderId,
  addTargetFolderId,
  setIsMobileAddOpen,
}: UseCabinetFormsOptions) {
  const router = useRouter()
  const confirm = useConfirm()

  const [folderToEdit, setFolderToEdit] = useState<any | null>(null)
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false)
  const [bookmarkToEdit, setBookmarkToEdit] = useState<any | null>(null)
  const [isBookmarkModalOpen, setIsBookmarkModalOpen] = useState(false)

  const resetFolderForm = useCallback(() => {
    setFolderToEdit(null)
    folderForm.reset()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  const resetBookmarkForm = useCallback(() => {
    setBookmarkToEdit(null)
    bookmarkForm.reset()
    bookmarkForm.setFieldValue("url", "")
    bookmarkForm.setFieldValue("title", "")
    bookmarkForm.setFieldValue("description", "")
    bookmarkForm.setFieldValue("folderId", addTargetFolderId || "")
    bookmarkForm.setFieldValue("tags", [])
  }, [addTargetFolderId]) // eslint-disable-line react-hooks/exhaustive-deps

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
          toast.success("Bookmark updated", { id: toastId })
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
          toast.success("Bookmark saved", { id: toastId })
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

  const handleEditFolder = useCallback((folder: any) => {
    setFolderToEdit(folder)
    folderForm.setFieldValue("name", folder.name)
    folderForm.setFieldValue("description", folder.description || "")
    folderForm.setFieldValue("parentId", folder.parentId || "")
    setIsFolderModalOpen(true)
  }, [folderForm])

  const handleDeleteFolder = useCallback(async (id: string) => {
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
  }, [confirm, removeFolderMutation, invalidateAllQueries, selectedFolderId, setSelectedFolderId])

  const handleCreateSubfolder = useCallback((parentId: string) => {
    setFolderToEdit(null)
    folderForm.reset()
    folderForm.setFieldValue("parentId", parentId)
    setIsFolderModalOpen(true)
  }, [folderForm])

  const handleEditBookmark = useCallback((bookmark: any) => {
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
  }, [bookmarkForm, router])

  const handleCreateNote = useCallback(() => {
    resetBookmarkForm()
    const params = new URLSearchParams({ new: "1" })
    if (addTargetFolderId) params.set("folder", addTargetFolderId)
    router.push(`/cabinet/notes/${crypto.randomUUID()}?${params}`)
  }, [addTargetFolderId, resetBookmarkForm, router])

  const handleCreateDrawing = useCallback(() => {
    const params = new URLSearchParams({ new: "1" })
    if (addTargetFolderId) params.set("folder", addTargetFolderId)
    router.push(`/cabinet/drawings/${crypto.randomUUID()}?${params}`)
  }, [addTargetFolderId, router])

  return {
    folderForm,
    folderToEdit,
    setFolderToEdit,
    isFolderModalOpen,
    setIsFolderModalOpen,
    resetFolderForm,
    handleEditFolder,
    handleDeleteFolder,
    handleCreateSubfolder,
    bookmarkForm,
    bookmarkToEdit,
    setBookmarkToEdit,
    isBookmarkModalOpen,
    setIsBookmarkModalOpen,
    resetBookmarkForm,
    handleEditBookmark,
    handleCreateNote,
    handleCreateDrawing,
  }
}

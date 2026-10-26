"use client"

import React, { useState, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  FilePdf,
  FileImage,
  UploadSimple,
  X,
  FolderSimple,
  Hash as TagIcon,
} from "@phosphor-icons/react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select"
import {
  TagsInput,
  TagsInputInput,
  TagsInputItem,
  TagsInputList,
} from "@/components/ui/tags-input"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/sonner"
import { uploadBookmarkToR2 } from "@/lib/api-client"
import { canAddToFolder } from "@/lib/folder-roles"
import { cn } from "@/lib/utils"

interface UploadFileDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  folders: any[]
  selectedFolderId?: string
}

export function UploadFileDialog({
  isOpen,
  onOpenChange,
  folders,
  selectedFolderId,
}: UploadFileDialogProps) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [folderId, setFolderId] = useState<string | undefined>(selectedFolderId)
  const [tags, setTags] = useState<string[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const resetForm = () => {
    setFile(null)
    setTitle("")
    setDescription("")
    setFolderId(selectedFolderId)
    setTags([])
    setIsUploading(false)
    setIsDragging(false)
  }

  const handleSelectFile = (selectedFile?: File | null) => {
    if (!selectedFile) return
    const isPdf = selectedFile.type === "application/pdf"
    const isImage = selectedFile.type.startsWith("image/")

    if (!isPdf && !isImage) {
      toast.error("Please choose a PDF document or an image file (JPEG, PNG, WebP, GIF, SVG).")
      return
    }

    if (isPdf && selectedFile.size > 50 * 1024 * 1024) {
      toast.error("PDF exceeds the 50MB size limit.")
      return
    }

    if (isImage && selectedFile.size > 15 * 1024 * 1024) {
      toast.error("Image exceeds the 15MB size limit.")
      return
    }

    setFile(selectedFile)
    const baseName = selectedFile.name.replace(/\.[^/.]+$/, "")
    setTitle(baseName)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) {
      toast.error("Please select a file to upload.")
      return
    }

    setIsUploading(true)
    const toastId = toast.loading(`Uploading "${file.name}" to Cloudflare R2…`)
    try {
      await uploadBookmarkToR2({
        file,
        title: title.trim() || file.name,
        description: description.trim() || undefined,
        folderId: folderId || undefined,
        tags,
      })

      toast.success("File uploaded and saved to your library", { id: toastId })
      for (const queryKey of [["/v1/bookmarks"], ["infinite", "/v1/bookmarks"], ["/v1/bookmarks/health"]]) {
        void queryClient.invalidateQueries({ queryKey })
      }
      onOpenChange(false)
      resetForm()
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to upload file", { id: toastId })
    } finally {
      setIsUploading(false)
    }
  }

  const isPdf = file?.type === "application/pdf"
  const isImage = file?.type.startsWith("image/")

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!isUploading) {
          onOpenChange(open)
          if (!open) resetForm()
        }
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg sm:w-full">
        <DialogHeader>
          <DialogTitle>Upload PDF or Image</DialogTitle>
          <DialogDescription>
            Store files on Cloudflare R2 and keep them organized in your Cabinet library.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FieldGroup>
            {!file ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  const dropped = e.dataTransfer.files?.[0]
                  handleSelectFile(dropped)
                }}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors",
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/20 hover:border-muted-foreground/40 hover:bg-muted/40"
                )}
              >
                <div className="flex size-10 items-center justify-center rounded-full bg-secondary text-foreground">
                  <UploadSimple className="size-5" />
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  <p className="text-sm font-medium">Click to select or drag &amp; drop</p>
                  <p className="text-xs text-muted-foreground">PDF (up to 50MB) or Images (JPEG, PNG, WebP, GIF, SVG up to 15MB)</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const picked = e.target.files?.[0]
                    handleSelectFile(picked)
                    e.target.value = ""
                  }}
                />
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                    {isPdf ? (
                      <FilePdf className="size-5 text-destructive" />
                    ) : (
                      <FileImage className="size-5 text-library-olive" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(2)} MB · {isPdf ? "PDF Document" : "Image"}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove selected file"
                  disabled={isUploading}
                  onClick={() => setFile(null)}
                >
                  <X />
                </Button>
              </div>
            )}

            <Field>
              <FieldLabel htmlFor="upload-title">Title</FieldLabel>
              <Input
                id="upload-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                maxLength={500}
                disabled={isUploading}
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="upload-desc">Description (Optional)</FieldLabel>
              <Input
                id="upload-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description"
                maxLength={1000}
                disabled={isUploading}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="upload-folder">Folder</FieldLabel>
              <Select
                value={folderId || "__root__"}
                onValueChange={(val) => setFolderId(val === "__root__" ? undefined : val)}
                disabled={isUploading}
              >
                <SelectTrigger id="upload-folder" className="w-full">
                  <FolderSimple className="size-4 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="Unfiled" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="__root__">Unfiled</SelectItem>
                    {folders.filter((f) => canAddToFolder(f)).map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="upload-tags">Tags</FieldLabel>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TagIcon className="size-4 shrink-0" aria-hidden="true" />
                <TagsInput
                  value={tags}
                  onValueChange={(next) => {
                    const clean = [...new Set(next.map((t) => t.trim().replace(/^#/, "").toLowerCase()).filter(Boolean))]
                    setTags(clean)
                  }}
                  disabled={isUploading}
                  className="min-w-0 flex-1"
                >
                  <TagsInputList className="min-h-9 rounded-md border border-input bg-card px-2 py-1 shadow-xs">
                    {tags.map((tag) => (
                      <TagsInputItem key={tag} value={tag} className="h-6 rounded-sm px-1.5 py-0 text-xs">
                        #{tag}
                      </TagsInputItem>
                    ))}
                    <TagsInputInput
                      id="upload-tags"
                      aria-label="Upload tags"
                      placeholder={tags.length ? "Add tag…" : "Add tags…"}
                      maxLength={30}
                      className="text-sm"
                    />
                  </TagsInputList>
                </TagsInput>
              </div>
            </Field>
          </FieldGroup>

          <DialogFooter className="mt-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!file || isUploading}>
              {isUploading ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Uploading…
                </>
              ) : (
                <>
                  <UploadSimple data-icon="inline-start" />
                  Upload
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

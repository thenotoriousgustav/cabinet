"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "@/components/ui/sonner"
import { uploadBookmarkToR2 } from "@/lib/api-client"

interface FinderFileDropOptions {
  enabled?: boolean
  targetFolderId?: string
  targetFolderName?: string
  onUploadSuccess?: () => void
}

const isPdfFile = (file: File) =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")

const isImageFile = (file: File) =>
  file.type.startsWith("image/") ||
  /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name)

export function useFinderFileDrop({
  enabled = true,
  targetFolderId,
  targetFolderName,
  onUploadSuccess,
}: FinderFileDropOptions) {
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounter = useRef(0)
  const optionsRef = useRef({ targetFolderId, targetFolderName, onUploadSuccess, enabled })
  optionsRef.current = { targetFolderId, targetFolderName, onUploadSuccess, enabled }

  useEffect(() => {
    if (!enabled) return

    const isOsFileDrag = (event: DragEvent) => {
      const types = event.dataTransfer?.types
      return types ? Array.from(types).includes("Files") : false
    }

    const handleDragEnter = (event: DragEvent) => {
      if (!isOsFileDrag(event)) return
      event.preventDefault()
      dragCounter.current += 1
      setIsDraggingOver(true)
    }

    const handleDragOver = (event: DragEvent) => {
      if (!isOsFileDrag(event)) return
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy"
      }
      if (!isDraggingOver) {
        setIsDraggingOver(true)
      }
    }

    const handleDragLeave = (event: DragEvent) => {
      if (!isOsFileDrag(event)) return
      event.preventDefault()
      dragCounter.current -= 1
      if (dragCounter.current <= 0) {
        dragCounter.current = 0
        setIsDraggingOver(false)
      }
    }

    const handleDrop = async (event: DragEvent) => {
      if (!isOsFileDrag(event)) return
      event.preventDefault()
      dragCounter.current = 0
      setIsDraggingOver(false)

      const files = Array.from(event.dataTransfer?.files || [])
      if (files.length === 0) return

      const validFiles = files.filter((f) => isPdfFile(f) || isImageFile(f))
      const invalidFiles = files.filter((f) => !isPdfFile(f) && !isImageFile(f))

      if (invalidFiles.length > 0) {
        toast.error(
          `Skipped ${invalidFiles.length} unsupported file(s). Only PDF documents and images are supported.`
        )
      }

      if (validFiles.length === 0) return

      const { targetFolderId, targetFolderName, onUploadSuccess } = optionsRef.current
      const destination = targetFolderName ? `"${targetFolderName}"` : "Cabinet"

      if (validFiles.length === 1) {
        const file = validFiles[0]
        if (!file) return
        const toastId = toast.loading(`Uploading "${file.name}" to ${destination}…`)
        try {
          const saved = await uploadBookmarkToR2({
            file,
            folderId: targetFolderId,
          })
          toast.success(`Saved: ${saved?.title || file.name}`, { id: toastId })
          onUploadSuccess?.()
        } catch (err: any) {
          toast.error(err.response?.data?.message || err.message || "Failed to upload file", {
            id: toastId,
          })
        }
      } else {
        const toastId = toast.loading(`Uploading ${validFiles.length} files to ${destination}…`)
        try {
          const results = await Promise.allSettled(
            validFiles.map((file) =>
              uploadBookmarkToR2({
                file,
                folderId: targetFolderId,
              })
            )
          )

          const succeeded = results.filter((r) => r.status === "fulfilled").length
          const failed = results.filter((r) => r.status === "rejected").length

          if (failed === 0) {
            toast.success(`Uploaded ${succeeded} files to ${destination}`, { id: toastId })
          } else if (succeeded > 0) {
            toast.warning(`Uploaded ${succeeded} files, ${failed} failed`, { id: toastId })
          } else {
            toast.error("Failed to upload files", { id: toastId })
          }

          if (succeeded > 0) {
            onUploadSuccess?.()
          }
        } catch {
          toast.error("Upload error", { id: toastId })
        }
      }
    }

    window.addEventListener("dragenter", handleDragEnter)
    window.addEventListener("dragover", handleDragOver)
    window.addEventListener("dragleave", handleDragLeave)
    window.addEventListener("drop", handleDrop)

    return () => {
      window.removeEventListener("dragenter", handleDragEnter)
      window.removeEventListener("dragover", handleDragOver)
      window.removeEventListener("dragleave", handleDragLeave)
      window.removeEventListener("drop", handleDrop)
    }
  }, [enabled])

  return { isDraggingOver }
}

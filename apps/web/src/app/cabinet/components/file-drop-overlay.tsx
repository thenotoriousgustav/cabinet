"use client"

import React from "react"
import { CloudArrowUp, FilePdf, FileImage } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

interface FileDropOverlayProps {
  isDraggingOver: boolean
  targetFolderName?: string
}

export function FileDropOverlay({ isDraggingOver, targetFolderName }: FileDropOverlayProps) {
  if (!isDraggingOver) return null

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6",
        "bg-background/90 transition-opacity duration-150"
      )}
      aria-hidden="true"
    >
      <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-primary bg-card p-10 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CloudArrowUp className="size-8" />
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-xl font-semibold tracking-tight text-foreground">
            Drop files to upload {targetFolderName ? `into "${targetFolderName}"` : "to Cabinet"}
          </p>
          <p className="text-sm text-muted-foreground">
            Files will be stored on Cloudflare R2 and saved directly to your library
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1 text-xs font-medium text-muted-foreground">
          <span className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1">
            <FilePdf className="size-4 text-destructive" /> PDF
          </span>
          <span className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1">
            <FileImage className="size-4 text-library-olive" /> Images
          </span>
        </div>
      </div>
    </div>
  )
}

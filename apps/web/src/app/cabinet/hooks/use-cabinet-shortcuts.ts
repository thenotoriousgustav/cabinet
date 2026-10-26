"use client"

import { useEffect } from "react"

interface CabinetShortcutsOptions {
  onNewNote: () => void
  onNewDrawing: () => void
  onNewBookmark: () => void
  onEscape?: () => void
  isAnyModalOpen: boolean
}

export function useCabinetShortcuts({
  onNewNote,
  onNewDrawing,
  onNewBookmark,
  onEscape,
  isAnyModalOpen,
}: CabinetShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null

      // Esc leaves selection mode unless a dialog, menu, or field handles it first.
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        onEscape &&
        !target?.closest("input, textarea, [contenteditable='true'], [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']")
      ) {
        onEscape()
        return
      }

      if (
        !target ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable ||
        target.closest("input, textarea, [contenteditable='true'], [role='dialog'], [role='alertdialog']")
      ) {
        return
      }

      if (isAnyModalOpen) {
        return
      }

      // Do not trigger single-key actions when meta, ctrl, or alt modifier keys are pressed
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return
      }

      // N: Create New Note
      if (e.key.toLowerCase() === "n") {
        e.preventDefault()
        onNewNote()
        return
      }

      // D: New drawing
      if (e.key.toLowerCase() === "d") {
        e.preventDefault()
        onNewDrawing()
        return
      }

      // B: Add New Bookmark
      if (e.key.toLowerCase() === "b") {
        e.preventDefault()
        onNewBookmark()
        return
      }

      // /: Focus Search input
      if (e.key === "/") {
        e.preventDefault()
        const searchInput = document.getElementById("cabinet-search-input") as HTMLInputElement | null
        if (searchInput) {
          searchInput.focus()
          searchInput.select()
        }
        return
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onNewNote, onNewDrawing, onNewBookmark, onEscape, isAnyModalOpen])
}

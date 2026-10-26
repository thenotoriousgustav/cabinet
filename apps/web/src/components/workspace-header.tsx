"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function WorkspaceHeader({ children, actions, onOpenNavigation, className }: {
  children?: React.ReactNode
  actions?: React.ReactNode
  onOpenNavigation?: () => void
  className?: string
}) {
  return <header className={cn("flex min-h-12 shrink-0 items-center gap-3 pt-2 pb-1 sm:pt-2.5 sm:pb-1", className)}>
    <SidebarTrigger onClick={onOpenNavigation} className="size-11 shrink-0 md:size-9" />
    <div className="flex min-w-0 flex-1 items-center gap-3">{children}{actions}</div>
  </header>
}

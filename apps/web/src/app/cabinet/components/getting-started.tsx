"use client"

import Link from "next/link"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle, X } from "@phosphor-icons/react"
import type { ActivityOverview } from "@cabinet/api-client"
import { Button } from "@/components/ui/button"
import { setOnboardingDismissed } from "@/lib/activity"
import { toast } from "@/components/ui/sonner"

export function GettingStarted({ progress, onSave, onOrganize }: {
  progress: ActivityOverview["onboarding"]; onSave: () => void; onOrganize: () => void
}) {
  const cache = useQueryClient()
  const [busy, setBusy] = useState(false)
  const steps = [
    { done: progress.savedLink, title: "Save your first link", description: "Keep a page you want to return to.", action: <Button size="sm" onClick={onSave}>Save a link</Button> },
    { done: progress.organized, title: "Give it a place", description: "Move an item into a folder or add a tag.", action: <Button size="sm" variant="outline" onClick={onOrganize}>Organize your library</Button> },
    { done: progress.extensionSaved, title: "Save from your browser", description: "Use the extension to save a page or highlight.", action: <Button size="sm" variant="outline" asChild><Link href="/cabinet/integrations?tab=extension#guides-heading">Set up extension</Link></Button> },
  ]
  const complete = steps.filter((step) => step.done).length
  const next = steps.find((step) => !step.done)
  if (progress.dismissed || complete === steps.length) return null
  return <section aria-labelledby="getting-started-title" className="rounded-lg border border-border bg-card p-4 sm:p-5">
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex flex-col gap-1"><h2 id="getting-started-title" className="text-base font-medium">A library worth returning to</h2><p className="text-sm text-muted-foreground">{complete} of {steps.length} steps complete · progress follows your saved items.</p></div>
      <Button variant="ghost" size="icon-sm" aria-label="Dismiss getting started" disabled={busy} onClick={async () => {
        setBusy(true)
        try { await setOnboardingDismissed(true); await cache.invalidateQueries({ queryKey: ["activity-overview"] }) }
        catch { toast.error("Could not dismiss getting started") }
        finally { setBusy(false) }
      }}><X /></Button>
    </div>
    {next && <div className="flex flex-col items-start gap-2 lg:hidden"><p className="text-sm font-medium">{next.title}</p><p className="text-sm text-muted-foreground">{next.description}</p>{next.action}</div>}
    <ol className="hidden gap-4 lg:grid lg:grid-cols-3">{steps.map((step) => <li key={step.title} className="flex min-w-0 flex-col items-start gap-2">
      <p className="flex items-center gap-2 text-sm font-medium">{step.done && <CheckCircle aria-hidden="true" className="size-4 shrink-0" />}{step.title}</p>
      <p className="text-sm leading-6 text-muted-foreground">{step.description}</p>
      {step.done ? <span className="text-sm text-muted-foreground">Complete</span> : step.action}
    </li>)}</ol>
  </section>
}

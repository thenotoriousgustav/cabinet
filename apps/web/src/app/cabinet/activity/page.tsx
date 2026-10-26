"use client"

import Link from "next/link"
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, ArrowClockwise } from "@phosphor-icons/react"
import type { BackgroundTask } from "@cabinet/api-client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { toast } from "@/components/ui/sonner"
import { authClient } from "@/lib/auth-client"
import { AXIOS_INSTANCE } from "@/lib/api-client"
import { cabinetActivity, setOnboardingDismissed } from "@/lib/activity"
import { safeHttpUrl } from "@/lib/shared-collection"

const labels: Record<string, string> = { PENDING: "Queued", RUNNING: "Running", PROCESSING: "Running", COMPLETED: "Complete", FAILED: "Needs attention" }
function Status({ status }: { status: string }) {
  return <Badge variant={status === "FAILED" ? "destructive" : "secondary"}>{["RUNNING", "PROCESSING"].includes(status) && <Spinner />}{labels[status] || status}</Badge>
}
function TaskProgress({ task }: { task: BackgroundTask }) {
  return <div className="flex flex-col gap-2">
    <p className="text-sm text-muted-foreground">{task.total > 0 ? `${task.processed.toLocaleString()} of ${task.total.toLocaleString()} ${task.kind === "IMPORT" ? "bookmarks saved" : "links checked"}` : task.status === "COMPLETED" ? "No links needed checking" : "Waiting for work to start"}{task.failed > 0 ? ` · ${task.failed} skipped or inconclusive` : ""}</p>
    {task.total > 0 && <progress aria-label={`${task.kind === "IMPORT" ? "Import" : "Link check"} progress`} max={task.total} value={Math.min(task.total, task.processed)} className="h-1.5 w-full max-w-sm appearance-none overflow-hidden rounded-full border-0 bg-muted [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-foreground [&::-moz-progress-bar]:bg-foreground" />}
  </div>
}

export default function ActivityPage() {
  const { data: session } = authClient.useSession()
  const cache = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(1)
  const query = useQuery({ queryKey: ["activity", session?.user.id, page], queryFn: () => cabinetActivity(page), enabled: !!session?.user.id, refetchInterval: (query) => query.state.data && query.state.data.summary.pending + query.state.data.summary.running > 0 ? 3000 : 30000 })
  const access = useQuery({ queryKey: ["operations-access", session?.user.id], enabled: !!session?.user.id, queryFn: async () => (await AXIOS_INSTANCE.get("/v1/operations/access")).data.data as { enabled: boolean }, staleTime: 60000 })
  const retry = async (path: string) => {
    setBusy(true)
    try {
      await AXIOS_INSTANCE.post(path)
      await Promise.all([query.refetch(), cache.invalidateQueries({ queryKey: ["activity-overview"] })])
      toast.success("Retry requested")
    } catch { toast.error("Could not retry this task. It may already be running or no longer available.") }
    finally { setBusy(false) }
  }
  const data = query.data
  return <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-8 px-4 py-6 sm:px-8 sm:py-10">
    <header className="flex flex-col gap-5">
      <Link href="/cabinet" className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft />Cabinet</Link>
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex flex-col gap-2"><h1 className="text-2xl font-semibold tracking-tight">Activity</h1><p className="text-sm text-muted-foreground">Imports, metadata, and link checks for your library.</p></div><div className="flex flex-wrap gap-2">{access.data?.enabled && <Button variant="outline" asChild><Link href="/cabinet/operations">Server measurements</Link></Button>}<Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}><ArrowClockwise data-icon="inline-start" />Refresh</Button></div></div>
    </header>
    {query.isLoading ? <div role="status" aria-label="Loading activity" className="flex flex-col gap-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /></div> : query.isError ? <Alert><AlertTitle>Could not load activity</AlertTitle><AlertDescription>Your library has not been changed. <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Try again</Button></AlertDescription></Alert> : data ? <>
      <dl className="grid grid-cols-2 gap-5 rounded-lg bg-muted/40 p-5 sm:grid-cols-4" aria-label="Background work summary">{[["Waiting", data.summary.pending], ["Running", data.summary.running], ["Needs attention", data.summary.failed], ["Complete", data.summary.completed]].map(([name, value]) => <div key={name} className="flex flex-col gap-1"><dt className="text-sm text-muted-foreground">{name}</dt><dd className="text-2xl tabular-nums">{Number(value).toLocaleString()}</dd></div>)}</dl>
      <section aria-labelledby="tasks-title" className="flex flex-col gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="tasks-title" className="text-base font-medium">Imports &amp; link checks</h2><Button variant="outline" size="sm" asChild><Link href="/cabinet/integrations">Import bookmarks</Link></Button></div>
        {data.tasks.length === 0 ? <Empty><EmptyHeader><EmptyTitle>{page === 1 ? "No background tasks yet" : "No more tasks on this page"}</EmptyTitle><EmptyDescription>{page === 1 ? "Import browser bookmarks or check your saved links from Settings → Maintenance." : "Use Previous page to return to recent work."}</EmptyDescription></EmptyHeader></Empty> : <ul className="flex flex-col">{data.tasks.map((task) => <li key={task.id} className="grid gap-3 border-b border-border py-5 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="flex min-w-0 flex-col gap-2"><p className="text-sm font-medium">{task.kind === "IMPORT" ? "Bookmark import" : "Link check"}</p><TaskProgress task={task} />{task.error && <p className="text-sm text-muted-foreground">{task.error}</p>}<time className="text-xs text-muted-foreground" dateTime={task.createdAt}>{new Date(task.createdAt).toLocaleString()}{task.attempt > 1 ? ` · attempt ${task.attempt}` : ""}</time></div><div className="flex items-start gap-3"><Status status={task.status} />{task.status === "FAILED" && <Button variant="outline" size="sm" disabled={busy} onClick={() => void retry(`/v1/activity/tasks/${task.id}/retry`)}>Retry</Button>}</div></li>)}</ul>}
        <p className="text-xs text-muted-foreground">30 tasks per page. Import completion means links are saved; metadata may continue separately. Retries keep already imported items.</p>
      </section>
      <section aria-labelledby="metadata-title" className="flex flex-col gap-4"><h2 id="metadata-title" className="text-base font-medium">Bookmark metadata</h2><p className="text-sm text-muted-foreground">Your bookmarks remain usable even when a website blocks its preview.</p>
        {data.metadata.length === 0 ? <Empty><EmptyHeader><EmptyTitle>{page === 1 ? "No metadata work yet" : "No more metadata work"}</EmptyTitle><EmptyDescription>{page === 1 ? "Save a link to start building your library. Notes and drawings do not need website metadata." : "Recent completed previews are shown on the first page."}</EmptyDescription></EmptyHeader>{page === 1 && <Button asChild><Link href="/cabinet">Save your first link</Link></Button>}</Empty> : <ul className="flex flex-col">{data.metadata.map((item) => <li key={item.id} className="grid gap-3 border-b border-border py-4 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="flex min-w-0 flex-col gap-1"><a href={safeHttpUrl(item.url)?.href} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-medium hover:underline">{item.title}</a><span className="truncate text-xs text-muted-foreground">{safeHttpUrl(item.url)?.hostname || "Saved link"}</span>{item.metadataError && <p className="text-sm text-muted-foreground">{item.metadataError}</p>}</div><div className="flex items-start gap-3"><Status status={item.metadataStatus} />{item.metadataStatus === "FAILED" && <Button variant="outline" size="sm" disabled={busy} aria-label={`Retry metadata for ${item.title}`} onClick={() => void retry(`/v1/activity/metadata/${item.id}/retry`)}>Retry</Button>}</div></li>)}</ul>}
        <p className="text-xs text-muted-foreground">30 items needing work per page, plus 10 recent completions on the first page. Missing cover images do not automatically trigger repeated requests.</p>
      </section>
    </> : null}
    {data && (data.hasMore || page > 1) && <nav aria-label="Activity pages" className="flex items-center justify-between gap-3"><Button variant="outline" disabled={page === 1 || query.isFetching} onClick={() => setPage((value) => value - 1)}>Previous page</Button><span className="text-sm text-muted-foreground">Page {page}</span><Button variant="outline" disabled={!data.hasMore || query.isFetching} onClick={() => setPage((value) => value + 1)}>Next page</Button></nav>}
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-sm text-muted-foreground"><span>Work continues after you leave this page.</span>{data?.summary.onboarding.savedLink && data.summary.onboarding.organized && data.summary.onboarding.extensionSaved ? <Link href="/cabinet/integrations?tab=extension" className="underline underline-offset-4">Extension guide</Link> : <Button variant="ghost" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await setOnboardingDismissed(false); await cache.invalidateQueries({ queryKey: ["activity-overview"] }); toast.success("Getting started is available in your library") } catch { toast.error("Could not show getting started") } finally { setBusy(false) } }}>Show getting started</Button>}</footer>
  </main>
}

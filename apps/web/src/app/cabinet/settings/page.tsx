"use client"

import React, { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, PaintBrush, User, Database, Wrench, Keyboard, Sun, Moon, Desktop, DownloadSimple, UploadSimple, SignOut, Trash, ArrowCounterClockwise, Hash as Tag } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/sonner"
import { useConfirm } from "@/hooks/use-confirm"
import { authClient } from "@/lib/auth-client"
import { AXIOS_INSTANCE, useBookmarksControllerGetHealthSummary, useBookmarksControllerFindAll, useBookmarksControllerGetDuplicates, useBookmarksControllerCleanDuplicates, useBookmarksControllerTriggerHealthCheck, useBookmarksControllerImport } from "@/lib/api-client"
import { defaultDisplayPreferences, densityOptions, isDensity, type DisplayPreferences } from "../components/display-preferences"
import { MoodboardCard } from "../components/bookmark-moodboard-view"
import { TagsSettings } from "./tags-settings"
import { DeleteAccount, SignInMethods } from "./account-settings"
import { readBookmarkImport } from "@/lib/import-bookmarks"

const settingsTabs = ["appearance", "account", "data", "tags", "maintenance", "shortcuts"] as const
type SettingsTab = (typeof settingsTabs)[number]

function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="grid items-start gap-5 border-b border-border/70 pb-8 last:border-0 md:grid-cols-[240px_minmax(0,1fr)] md:gap-10">
    <div className="flex flex-col gap-2 md:pt-5"><h2 className="text-base font-medium text-foreground">{title}</h2><p className="text-sm leading-6 text-muted-foreground">{description}</p></div>
    <Card><CardContent className="flex flex-col gap-5 p-5 sm:p-6">{children}</CardContent></Card>
  </section>
}

const noop = () => {}
const getHostname = (url: string) => { try { return new URL(url).hostname } catch { return "" } }

export default function SettingsPage() {
  const router = useRouter()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const { theme, setTheme } = useTheme()
  const { data: session } = authClient.useSession()
  const user = session?.user
  const [mounted, setMounted] = useState(false)
  const [tab, setTab] = useState<SettingsTab>("appearance")
  // Deep links such as /cabinet/settings?tab=tags open the matching tab.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab")
    if (settingsTabs.includes(requested as SettingsTab)) setTab(requested as SettingsTab)
  }, [])
  const changeTab = (value: string) => {
    if (!settingsTabs.includes(value as SettingsTab)) return
    setTab(value as SettingsTab)
    const url = new URL(window.location.href)
    if (value === "appearance") url.searchParams.delete("tab")
    else url.searchParams.set("tab", value)
    window.history.replaceState(window.history.state, "", url)
  }
  const [displayPrefs, setDisplayPrefs] = useState<DisplayPreferences>(defaultDisplayPreferences)
  const [preferenceStatus, setPreferenceStatus] = useState("")
  const { data: previewData, isLoading: isPreviewLoading, isError: isPreviewError } = useBookmarksControllerFindAll({ limit: 1, sort: "newest", isArchived: false, isTrash: false }, { query: { staleTime: 60000 } })
  const previewBookmark = (previewData as any)?.data?.data?.[0]
  const { data: healthData, refetch: refetchHealth } = useBookmarksControllerGetHealthSummary()
  const health = (healthData as any)?.data || healthData
  const { data: duplicatesData, refetch: refetchDuplicates } = useBookmarksControllerGetDuplicates({ query: { enabled: true } })
  const duplicates = (duplicatesData as any)?.data || duplicatesData || []
  const cleanDuplicatesMutation = useBookmarksControllerCleanDuplicates()
  const triggerHealthMutation = useBookmarksControllerTriggerHealthCheck()
  const importMutation = useBookmarksControllerImport()
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isEmptyingTrash, setIsEmptyingTrash] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      const parsed = JSON.parse(localStorage.getItem("cabinet_display_preferences") || "null")
      if (typeof parsed === "object" && parsed !== null) setDisplayPrefs({ ...defaultDisplayPreferences, ...parsed })
    } catch {}
  }, [])

  const savePreference = (key: string, value: string) => {
    try { localStorage.setItem(key, value); setPreferenceStatus("Saved on this device") }
    catch { setPreferenceStatus("Could not save on this device"); toast.error("Could not save your preferences on this device") }
  }
  const handlePrefToggle = <Key extends keyof DisplayPreferences,>(key: Key, value: DisplayPreferences[Key]) => {
    const updated = { ...displayPrefs, [key]: value }
    setDisplayPrefs(updated)
    savePreference("cabinet_display_preferences", JSON.stringify(updated))
  }
  const handleExport = async () => {
    setIsExporting(true)
    try {
      const response = await AXIOS_INSTANCE.get("/v1/bookmarks/export", { responseType: "blob" })
      const url = URL.createObjectURL(new Blob([response.data], { type: "text/html;charset=utf-8" }))
      const a = document.createElement("a")
      a.href = url
      a.download = `cabinet-bookmarks-${new Date().toISOString().split("T")[0]}.html`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success("Bookmarks exported successfully")
    } catch { toast.error("Failed to export bookmarks") }
    finally { setIsExporting(false) }
  }
  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setIsImporting(true)
    const toastId = toast.loading("Importing bookmarks from file...")
    try {
      await importMutation.mutateAsync({ data: { htmlContent: await readBookmarkImport(file) } })
      for (const queryKey of [["/v1/bookmarks"], ["infinite", "/v1/bookmarks"], ["/v1/folders"], ["/v1/tags"]]) queryClient.invalidateQueries({ queryKey })
      queryClient.invalidateQueries({ queryKey: ["activity-overview"] })
      toast.success("Import queued. You can leave this page.", { id: toastId, action: { label: "View progress", onClick: () => router.push("/cabinet/activity") } })
    } catch (error) { toast.error(error instanceof Error ? error.message : "Failed to start bookmark import", { id: toastId }) }
    finally { setIsImporting(false); event.target.value = "" }
  }
  const handleScanLinks = async () => {
    setIsScanning(true)
    try { await triggerHealthMutation.mutateAsync(); queryClient.invalidateQueries({ queryKey: ["activity-overview"] }); toast.success("Link check queued", { action: { label: "View progress", onClick: () => router.push("/cabinet/activity") } }) }
    catch { toast.error("Failed to start health scan") }
    finally { setIsScanning(false) }
  }
  const handleCleanDuplicates = async () => {
    if (!await confirm({ title: "Clean Duplicate Bookmarks?", description: "This will automatically remove duplicate bookmark instances and keep the oldest instance of each URL.", actionLabel: "Clean Duplicates", variant: "destructive" })) return
    try {
      await cleanDuplicatesMutation.mutateAsync()
      queryClient.invalidateQueries({ queryKey: ["/v1/bookmarks"] })
      queryClient.invalidateQueries({ queryKey: ["infinite", "/v1/bookmarks"] })
      refetchDuplicates()
      toast.success("Duplicate bookmarks successfully cleaned")
    } catch { toast.error("Failed to clean duplicates") }
  }
  const handleEmptyTrash = async () => {
    if (!await confirm({ title: "Empty Trash?", description: "This will permanently delete all bookmarks currently in the Trash. This action cannot be undone.", actionLabel: "Empty Trash", variant: "destructive" })) return
    setIsEmptyingTrash(true)
    try {
      await AXIOS_INSTANCE.delete("/v1/bookmarks/trash/empty")
      queryClient.invalidateQueries({ queryKey: ["/v1/bookmarks"] })
      queryClient.invalidateQueries({ queryKey: ["infinite", "/v1/bookmarks"] })
      refetchHealth()
      toast.success("Trash emptied permanently")
    } catch { toast.error("Failed to empty trash") }
    finally { setIsEmptyingTrash(false) }
  }
  const handleLogout = async () => {
    try {
      const { error } = await authClient.signOut()
      if (error) throw new Error(error.message || "Sign-out failed")
      queryClient.clear()
      router.replace("/login")
    } catch { toast.error("Sign out failed. Try again.") }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-8 px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-6">
        <Link href="/cabinet" className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft />Back to Cabinet</Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-2"><h1 className="text-2xl font-semibold tracking-tight">Settings</h1><p className="text-sm text-muted-foreground">Make Cabinet feel like your own library.</p></div>
          <p role="status" className="text-xs text-muted-foreground">{preferenceStatus}</p>
        </div>
      </header>
      <Tabs value={tab} onValueChange={changeTab} className="flex flex-col gap-8">
        <div className="min-w-0 overflow-x-auto">
          <TabsList variant="line" className="h-auto w-max min-w-full justify-start gap-4">
            {([ ["appearance", "Appearance", PaintBrush], ["account", "Account", User], ["data", "Data & Export", Database], ["tags", "Tags", Tag], ["maintenance", "Maintenance", Wrench], ["shortcuts", "Shortcuts", Keyboard] ] as const).map(([value, label, Icon]) => <TabsTrigger key={value} value={value} className="min-h-11 shrink-0 gap-2 text-sm"><Icon />{label}</TabsTrigger>)}
          </TabsList>
        </div>
        <TabsContent value="appearance" className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex min-w-0 flex-col gap-8">
          <SettingsSection title="Theme" description="Choose a light or dark library, or follow your device. Changes apply immediately.">
            <ToggleGroup type="single" variant="outline" value={mounted ? theme || "system" : "system"} onValueChange={(value) => { if (value) setTheme(value) }} aria-label="Theme">
              {([ ["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "System", Desktop] ] as const).map(([value, label, Icon]) => <ToggleGroupItem key={value} value={value} className="min-h-11 gap-2"><Icon />{label}</ToggleGroupItem>)}
            </ToggleGroup>
          </SettingsSection>
          <SettingsSection title="Layout & density" description="Choose how much of your collection fits on screen. These preferences are saved in this browser.">
            <div className="flex flex-col gap-2"><p className="text-sm font-medium">Density</p>
              <ToggleGroup type="single" variant="outline" value={displayPrefs.density} onValueChange={(value) => { if (isDensity(value)) handlePrefToggle("density", value) }} aria-label="Density">
                {densityOptions.map((option) => <ToggleGroupItem key={option.value} value={option.value} className="min-h-11">{option.label}</ToggleGroupItem>)}
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">Visual shows previews edge to edge with just the title, like a gallery.</p>
            </div>
          </SettingsSection>
          <SettingsSection title="Visible details" description="Keep the details you use and hide the rest. Your saved content is never changed.">
            <div className="flex flex-col divide-y divide-border/70">
              {([ ["showImage", "Preview image", "The website preview, when available."], ["showTitle", "Title", "The saved or custom title."], ["showDescription", "Description", "A short excerpt below the title."], ["showWebsite", "Website", "The original website domain."], ["showFolder", "Folder", "Where the item is filed."], ["showDate", "Date added", "When you saved the item."] ] as const).map(([key, label, description]) => <div key={key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-1"><label htmlFor={key} className="cursor-pointer text-sm font-medium">{label}</label><p id={`${key}-description`} className="text-xs text-muted-foreground">{description}</p></div>
                <Switch id={key} aria-describedby={`${key}-description`} checked={displayPrefs[key]} onCheckedChange={(value) => handlePrefToggle(key, value)} />
              </div>)}
            </div>
          </SettingsSection>
          </div>
          <aside aria-label="Display preview" className="flex flex-col gap-3 xl:sticky xl:top-8">
            <h2 className="text-base font-medium">Display preview</h2>
            <p className="text-xs leading-5 text-muted-foreground">From your saved library. Changes appear here immediately.</p>
            {previewBookmark ? <div inert aria-hidden="true" className="max-w-sm">
              <MoodboardCard showActions={false} nativeDrag={false} displayPreferences={displayPrefs} bookmark={previewBookmark} folders={previewBookmark.folder ? [previewBookmark.folder] : []} isSelected={false} onToggleSelect={noop} onSelectTag={noop} onToggleFavorite={noop} onToggleArchive={noop} onEditBookmark={noop} onDeleteBookmark={noop} onDuplicateBookmark={noop} getHostname={getHostname} />
            </div> : <p className="text-sm text-muted-foreground">{isPreviewLoading ? "Loading display preview…" : isPreviewError ? "Could not load the display preview. Reload to try again." : "Save a bookmark to see your preferences applied here."}</p>}
          </aside>
        </TabsContent>
        <TabsContent value="account" className="flex flex-col gap-8">
          <SettingsSection title="Your account" description="The account connected to this Cabinet library.">
            <div className="flex items-center gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-secondary text-lg">{user?.name?.[0]?.toUpperCase() || "C"}</span><div className="min-w-0"><p className="truncate text-base font-medium">{user?.name || "Cabinet User"}</p><p className="truncate text-sm text-muted-foreground">{user?.email || "No email available"}</p></div></div>
            {user?.id && <p className="text-xs text-muted-foreground">Account ID: <code>{user.id.slice(0, 8)}</code></p>}
          </SettingsSection>
          <SettingsSection title="Sign-in methods" description="The accounts you can sign in with. Connect both so you always have a way back in.">
            <SignInMethods />
          </SettingsSection>
          <SettingsSection title="Session" description="Sign out of Cabinet on this browser. Your saved library stays in your account."><Button variant="outline" className="w-fit" onClick={handleLogout}><SignOut data-icon="inline-start" />Sign Out</Button></SettingsSection>
          <SettingsSection title="Delete account" description="Close your Cabinet account and erase your library.">
            <DeleteAccount />
          </SettingsSection>
        </TabsContent>
        <TabsContent value="data" className="flex flex-col gap-8">
          <SettingsSection title="Export your bookmarks" description="Download a standard HTML bookmarks file to keep a backup or move to another browser."><Button className="w-fit" disabled={isExporting} onClick={handleExport}>{isExporting ? <Spinner /> : <DownloadSimple data-icon="inline-start" />}{isExporting ? "Generating export…" : "Download HTML export"}</Button><p className="text-xs text-muted-foreground">Compatible with Chrome, Safari, Firefox, Arc, Brave, and Raindrop.io.</p></SettingsSection>
          <SettingsSection title="Import bookmarks" description="Bring an HTML bookmarks export into Cabinet. Folders are preserved and previews are fetched in the background.">
            <label className="relative w-fit rounded-md has-focus-visible:outline-2 has-focus-visible:outline-ring"><span className="flex min-h-11 items-center gap-2 rounded-md border border-input px-4 text-sm">{isImporting ? <Spinner /> : <UploadSimple />}{isImporting ? "Queuing import…" : "Choose HTML file"}</span><input type="file" accept=".html" aria-label="Choose HTML file to import" onChange={handleImportFile} disabled={isImporting} className="absolute inset-0 size-full cursor-pointer opacity-0" /></label>
            <p className="text-xs text-muted-foreground">
              Butuh panduan ekspor langkah demi langkah dari Chrome, Safari, atau Raindrop?{" "}
              <Link href="/cabinet/integrations" className="text-foreground underline underline-offset-4 hover:text-primary">
                Buka panduan integrasi lengkap &amp; alur visual →
              </Link>
            </p>
          </SettingsSection>
        </TabsContent>
        <TabsContent value="tags" className="flex flex-col gap-8">
          <SettingsSection title="Tags" description="Rename, merge, or delete tags across your whole library. Most used tags come first.">
            <TagsSettings />
          </SettingsSection>
        </TabsContent>
        <TabsContent value="maintenance" className="flex flex-col gap-8">
          <SettingsSection title="Link health" description="Check whether your saved links are still available. Scans run in the background.">
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">{([ ["Total links", health?.total || 0], ["Healthy", health?.ok || 0], ["Redirected", health?.redirected || 0], ["Broken", health?.broken || 0] ] as const).map(([label, value]) => <div key={label}><p className="text-2xl tabular-nums">{value.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></div>)}</div>
            <Button variant="outline" className="w-fit" onClick={handleScanLinks} disabled={isScanning}>{isScanning ? <Spinner /> : <ArrowCounterClockwise data-icon="inline-start" />}{isScanning ? "Scanning…" : "Run Health Scan"}</Button>
          </SettingsSection>
          <SettingsSection title="Duplicate URLs" description="Keep the oldest bookmark for each URL and remove its extra copies."><p className="text-sm tabular-nums">{duplicates.length} duplicate groups</p><Button variant="outline" className="w-fit" onClick={handleCleanDuplicates} disabled={duplicates.length === 0 || cleanDuplicatesMutation.isPending}>Clean Duplicates</Button></SettingsSection>
          <SettingsSection title="Empty trash" description="Permanently delete everything in the trash. This cannot be undone."><p className="text-sm tabular-nums">{health?.trash || 0} bookmarks in the trash</p><Button variant="outline" className="w-fit" onClick={handleEmptyTrash} disabled={(health?.trash || 0) === 0 || isEmptyingTrash}>{isEmptyingTrash ? <Spinner /> : <Trash data-icon="inline-start" />}Empty Trash</Button></SettingsSection>
        </TabsContent>
        <TabsContent value="shortcuts" className="flex flex-col gap-8">
          <SettingsSection title="Keyboard shortcuts" description="Move through your library without leaving the keyboard.">
            <dl className="flex flex-col divide-y divide-border/70">{[
              ["/", "Focus search"], ["N", "Create note"], ["D", "New drawing"], ["B", "Add bookmark"], ["⌘B", "Toggle sidebar"], ["⌘K", "Command menu"], ["Space / Enter", "Pick up or drop an item"], ["Arrow keys", "Move a sortable item"], ["Esc", "Clear selection, cancel drag, or close dialog"], ["Click", "Open an item in Cabinet"], ["Shift + Click", "Select items"], ["⌘ / Ctrl + Click", "Open the original in a new tab"], ["← / →", "Previous or next item in preview"],
            ].map(([keys, label]) => <div key={keys} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"><dt className="text-sm">{label}</dt><dd className="shrink-0"><kbd className="rounded-sm border border-border bg-muted px-2 py-1 text-xs">{keys}</kbd></dd></div>)}</dl>
          </SettingsSection>
        </TabsContent>
      </Tabs>
      <footer className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-6 text-xs text-muted-foreground"><span className="font-serif text-xl text-foreground">Cabinet</span><span>A personal place for what you want to keep.</span></footer>
    </main>
  )
}

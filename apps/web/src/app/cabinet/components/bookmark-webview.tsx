"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { AXIOS_INSTANCE } from "@/lib/api-client"
import {
  ArrowClockwise,
  ArrowSquareOut,
  CaretLeft,
  CaretRight,
  SidebarSimple,
  X,
  DownloadSimple,
  FilePdf,
  FileImage,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  ArrowsIn,
  Printer,
  PencilSimple,
  ArrowUUpLeft,
  ArrowUUpRight,
} from "@phosphor-icons/react"
import { getProxiedImageUrl } from "@/lib/bookmark-image"
import {
  DIRECT_FRAME_SANDBOX,
  PROXIED_FRAME_SANDBOX,
  PREVIEW_ERROR_MESSAGE,
  PREVIEW_READY_MESSAGE,
  PREVIEW_NAVIGATE_MESSAGE,
  getProxiedPageUrl,
  getYouTubeEmbedUrl,
} from "@/lib/bookmark-page"
import { isImageBookmark, isPdfBookmark } from "@/lib/bookmark-kind"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { ButtonGroup, ButtonGroupSeparator } from "@/components/ui/button-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { safeHttpUrl } from "@/lib/shared-collection"
import { cn } from "@/lib/utils"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"

type PreviewBookmark = {
  id: string
  url: string
  title?: string
  description?: string | null
  imageUrl?: string | null
  contentType?: string | null
  type?: string | null
}

function ImageViewer({ src, title }: { src: string; title?: string }) {
  const [zoom, setZoom] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const zoomIn = () => setZoom((z) => Math.min(z + 0.5, 4))
  const zoomOut = () => setZoom((z) => Math.max(z - 0.5, 0.5))
  const resetZoom = () => setZoom(1)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-neutral-950 text-white select-none">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4 sm:p-8">
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground" role="status">
            <Spinner className="size-6 text-neutral-400" />
          </div>
        )}
        {error ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <FileImage className="size-12 text-neutral-500" />
            <p className="text-sm text-neutral-400">Could not display image preview.</p>
            <Button variant="outline" asChild>
              <a href={src} target="_blank" rel="noopener noreferrer">
                <ArrowSquareOut data-icon="inline-start" /> Open original
              </a>
            </Button>
          </div>
        ) : (
          <img
            src={src}
            alt={title || "Image"}
            draggable={false}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false)
              setError(true)
            }}
            style={{
              transform: `scale(${zoom})`,
              transition: "transform 0.15s ease-out",
            }}
            className={cn(
              "max-h-full max-w-full object-contain transition-opacity duration-150",
              loading ? "opacity-0" : "opacity-100",
              zoom > 1 ? "cursor-zoom-out" : "cursor-zoom-in"
            )}
            onClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
          />
        )}
      </div>

      {/* Floating Zoom Bar */}
      {!error && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-neutral-800 bg-neutral-900/95 px-2.5 py-1">
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={zoom <= 0.5 || loading}
            onClick={zoomOut}
            aria-label="Zoom out"
            title="Zoom out (-)"
            className="text-neutral-300 hover:bg-neutral-800 hover:text-white"
          >
            <MagnifyingGlassMinus className="size-3.5" />
          </Button>
          <button
            type="button"
            disabled={loading}
            onClick={resetZoom}
            className="px-2 text-xs font-medium tabular-nums text-neutral-300 hover:text-white"
            title="Reset zoom (100%)"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={zoom >= 4 || loading}
            onClick={zoomIn}
            aria-label="Zoom in"
            title="Zoom in (+)"
            className="text-neutral-300 hover:bg-neutral-800 hover:text-white"
          >
            <MagnifyingGlassPlus className="size-3.5" />
          </Button>
          {zoom !== 1 && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={resetZoom}
              aria-label="Fit to screen"
              title="Fit to screen"
              className="text-neutral-300 hover:bg-neutral-800 hover:text-white"
            >
              <ArrowsIn className="size-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function PdfThumbnail({ url, pageNumber }: { url: string; pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist")
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
        const pdf = await pdfjs.getDocument({ url, withCredentials: true }).promise
        const page = await pdf.getPage(pageNumber)
        if (cancelled || !canvasRef.current) return
        const viewport = page.getViewport({ scale: 0.28 * Math.min(window.devicePixelRatio || 1, 2) })
        const canvas = canvasRef.current
        const context = canvas.getContext("2d")
        if (!context) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        await page.render({ canvas, canvasContext: context, viewport }).promise
      } catch {
        // An empty page tile is preferable to failing the full document viewer.
      }
    })()
    return () => { cancelled = true }
  }, [url, pageNumber])

  return <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full object-contain" />
}

function PdfSheet({ url, pageNumber, zoom, rotation }: { url: string; pageNumber: number; zoom: number; rotation: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    let cancelRender: (() => void) | undefined
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist")
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
        const pdf = await pdfjs.getDocument({ url, withCredentials: true }).promise
        const page = await pdf.getPage(pageNumber)
        if (cancelled || !canvasRef.current) return
        const viewport = page.getViewport({ scale: zoom * 1.5 * Math.min(window.devicePixelRatio || 1, 2), rotation })
        const canvas = canvasRef.current
        const context = canvas.getContext("2d")
        if (!context) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        const task = page.render({ canvas, canvasContext: context, viewport })
        cancelRender = () => task.cancel()
        await task.promise
      } catch { /* The page placeholder remains when an individual page fails. */ }
    })()
    return () => { cancelled = true; cancelRender?.() }
  }, [url, pageNumber, zoom, rotation])
  return <canvas ref={canvasRef} aria-label={`PDF page ${pageNumber}`} className="block h-auto w-full bg-white shadow-xl" />
}

function PdfViewer({ url, title }: { url: string; title?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [showPages, setShowPages] = useState(true)
  const [continuous, setContinuous] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [strokes, setStrokes] = useState<string[]>([])
  const [redoStrokes, setRedoStrokes] = useState<string[]>([])
  const [activeStroke, setActiveStroke] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    let cancelRender: (() => void) | undefined

    void (async () => {
      setLoading(true)
      setLoadError(false)
      try {
        const pdfjs = await import("pdfjs-dist")
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
        const pdf = await pdfjs.getDocument({ url, withCredentials: true }).promise
        if (cancelled) return
        setPageCount(pdf.numPages)
        const pdfPage = await pdf.getPage(page)
        if (cancelled || !canvasRef.current) return

        const viewport = pdfPage.getViewport({ scale: zoom * 1.5 * Math.min(window.devicePixelRatio || 1, 2), rotation })
        const canvas = canvasRef.current
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Canvas is unavailable")
        canvas.width = viewport.width
        canvas.height = viewport.height
        const task = pdfPage.render({ canvas, canvasContext: context, viewport })
        cancelRender = () => task.cancel()
        await task.promise
        if (!cancelled) setLoading(false)
      } catch {
        if (!cancelled) {
          setLoading(false)
          setLoadError(true)
        }
      }
    })()

    return () => {
      cancelled = true
      cancelRender?.()
    }
  }, [url, page, zoom, rotation])

  useEffect(() => {
    if (continuous) document.getElementById(`pdf-page-${page}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [continuous, page])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-neutral-900 text-neutral-100">
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-neutral-700 bg-neutral-800 px-3">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ButtonGroup aria-label="Page navigation" className="shrink-0">
            <Button variant="ghost" size="icon-sm" aria-label="Toggle page thumbnails" title="Thumbnails" aria-pressed={showPages} onClick={() => setShowPages((shown) => !shown)} className="text-neutral-300 hover:bg-neutral-700 hover:text-white"><SidebarSimple /></Button>
            <ButtonGroupSeparator className="bg-neutral-600" />
            <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage((n) => n - 1)} className="text-neutral-300 hover:bg-neutral-700 hover:text-white"><CaretLeft /></Button>
            <span aria-live="polite" className="flex h-8 min-w-[4.5rem] items-center justify-center px-1 text-xs tabular-nums text-neutral-100">{pageCount ? `${page} / ${pageCount}` : "— / —"}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pageCount || loading} onClick={() => setPage((n) => n + 1)} className="text-neutral-300 hover:bg-neutral-700 hover:text-white"><CaretRight /></Button>
          </ButtonGroup>

          <ButtonGroup aria-label="Zoom controls" className="shrink-0">
            <Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={zoom <= 0.5 || loading} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} className="text-neutral-300 hover:bg-neutral-700 hover:text-white"><MagnifyingGlassMinus /></Button>
            <span className="flex h-8 min-w-11 items-center justify-center px-1 text-xs tabular-nums text-neutral-100">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={zoom >= 2 || loading} onClick={() => setZoom((z) => Math.min(2, z + 0.25))} className="text-neutral-300 hover:bg-neutral-700 hover:text-white"><MagnifyingGlassPlus /></Button>
            <ButtonGroupSeparator className="bg-neutral-600" />
            <Button variant="ghost" size="icon-sm" aria-label="Fit page" title="Fit page" disabled={loading} onClick={() => setZoom(1)} className="text-neutral-300 hover:bg-neutral-700 hover:text-white"><ArrowsIn /></Button>
          </ButtonGroup>

          <ToggleGroup type="single" value={continuous ? "continuous" : "single"} onValueChange={(value) => { if (value) setContinuous(value === "continuous") }} aria-label="Page layout" variant="outline" size="sm" spacing={0} className="h-8 shrink-0 rounded-md border border-neutral-600 bg-neutral-900 p-0.5 text-neutral-300">
            <ToggleGroupItem value="single" className="h-7 min-w-0 rounded px-2 text-xs text-neutral-300 hover:bg-neutral-700 hover:text-white data-[state=on]:bg-neutral-700 data-[state=on]:text-white">Single page</ToggleGroupItem>
            <ToggleGroupItem value="continuous" className="h-7 min-w-0 rounded px-2 text-xs text-neutral-300 hover:bg-neutral-700 hover:text-white data-[state=on]:bg-neutral-700 data-[state=on]:text-white">Continuous</ToggleGroupItem>
          </ToggleGroup>

          <ButtonGroup aria-label="Annotations" className="shrink-0">
            <Button variant={drawing ? "secondary" : "ghost"} size="icon-sm" aria-label="Draw on page" title="Draw on page" disabled={loading} onClick={() => setDrawing((value) => !value)} className="text-neutral-300 hover:bg-neutral-700 hover:text-white aria-pressed:bg-neutral-700" aria-pressed={drawing}><PencilSimple /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Undo drawing" title="Undo" disabled={!strokes.length} onClick={() => { const previous = strokes.at(-1); if (previous) { setStrokes(strokes.slice(0, -1)); setRedoStrokes([...redoStrokes, previous]) } }} className="text-neutral-300 hover:bg-neutral-700 hover:text-white"><ArrowUUpLeft /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Redo drawing" title="Redo" disabled={!redoStrokes.length} onClick={() => { const next = redoStrokes.at(-1); if (next) { setRedoStrokes(redoStrokes.slice(0, -1)); setStrokes([...strokes, next]) } }} className="text-neutral-300 hover:bg-neutral-700 hover:text-white"><ArrowUUpRight /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Rotate clockwise" title="Rotate clockwise" disabled={loading} onClick={() => setRotation((r) => (r + 90) % 360)} className="text-neutral-300 hover:bg-neutral-700 hover:text-white"><ArrowClockwise /></Button>
          </ButtonGroup>
        </div>
        <div className="flex shrink-0 items-center gap-1 border-l border-neutral-700 pl-3">
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-neutral-300 hover:bg-neutral-700 hover:text-white" asChild><a href={url} download={title || "document.pdf"}><DownloadSimple data-icon="inline-start" />Download</a></Button>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-neutral-300 hover:bg-neutral-700 hover:text-white" onClick={() => window.open(url, "_blank", "noopener,noreferrer")?.print()}><Printer data-icon="inline-start" />Print</Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {showPages && !loadError && <aside aria-label="PDF pages" className="w-24 shrink-0 overflow-y-auto border-r border-neutral-700 bg-neutral-800 p-2 sm:w-36">
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
            <button key={pageNumber} type="button" onClick={() => setPage(pageNumber)} aria-label={`Go to page ${pageNumber}`} aria-current={page === pageNumber ? "page" : undefined} className={cn("mb-2 flex w-full flex-col items-center gap-1 rounded border p-2 text-xs", page === pageNumber ? "border-primary bg-primary/10 text-foreground" : "border-transparent text-muted-foreground hover:bg-neutral-700")}>
              <span className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden bg-white"><PdfThumbnail url={url} pageNumber={pageNumber} /></span>{pageNumber}
            </button>
          ))}
        </aside>}
        <div className="relative flex min-h-0 min-w-0 flex-1 justify-center overflow-auto p-6">
          {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-900/60"><Spinner className="size-6" /></div>}
          {loadError ? (
            <div className="flex flex-col items-center justify-center gap-3 text-center">
              <FilePdf className="size-10 text-neutral-400" />
              <p className="text-sm text-neutral-300">Couldn’t render this PDF preview.</p>
              <Button variant="outline" asChild><a href={url} target="_blank" rel="noopener noreferrer"><ArrowSquareOut data-icon="inline-start" /> Open original</a></Button>
            </div>
          ) : continuous ? (
            <div className="flex w-full flex-col items-center gap-2">
              {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => <div id={`pdf-page-${pageNumber}`} key={pageNumber} className="w-full max-w-5xl"><PdfSheet url={url} pageNumber={pageNumber} zoom={zoom} rotation={rotation} /></div>)}
            </div>
          ) : <div className="relative h-fit shrink-0" style={{ width: `${zoom * 100}%` }}>
            <canvas ref={canvasRef} aria-label={`${title || "PDF"}, page ${page}`} className="block h-auto w-full bg-white shadow-xl" />
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={cn("absolute inset-0 h-full w-full", drawing ? "touch-none cursor-crosshair" : "pointer-events-none")} onPointerDown={(event) => { if (!drawing) return; event.currentTarget.setPointerCapture(event.pointerId); const rect = event.currentTarget.getBoundingClientRect(); setActiveStroke(`M ${(event.clientX - rect.left) / rect.width * 100} ${(event.clientY - rect.top) / rect.height * 100}`) }} onPointerMove={(event) => { if (!drawing || !activeStroke) return; const rect = event.currentTarget.getBoundingClientRect(); setActiveStroke((path) => `${path} L ${(event.clientX - rect.left) / rect.width * 100} ${(event.clientY - rect.top) / rect.height * 100}`) }} onPointerUp={() => { if (activeStroke) { setStrokes([...strokes, activeStroke]); setRedoStrokes([]); setActiveStroke("") } }}>
              {[...strokes, activeStroke].filter(Boolean).map((path, index) => <path key={`${index}-${path.slice(0, 12)}`} d={path} fill="none" stroke="#e11d48" strokeWidth="0.7" strokeLinecap="round" strokeLinejoin="round" />)}
            </svg>
          </div>}
        </div>
      </div>
    </div>
  )
}

export function BookmarkWebview({
  bookmark,
  onClose,
  onPrevious,
  onNext,
  inspector,
  showDetails = true,
  onToggleDetails,
}: {
  bookmark: PreviewBookmark
  onClose: () => void
  onPrevious?: () => void
  onNext?: () => void
  inspector?: ReactNode
  showDetails?: boolean
  onToggleDetails?: () => void
}) {
  const [reload, setReload] = useState(0)
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [contentConfirmed, setContentConfirmed] = useState(false)
  // The site refused the proxy (bot protection), so retrying the live preview cannot help.
  const [siteBlocked, setSiteBlocked] = useState(false)
  const website = safeHttpUrl(bookmark.url)
  const youtubeEmbedUrl = getYouTubeEmbedUrl(website?.href)

  const isImage = isImageBookmark(bookmark)
  const isPdf = isPdfBookmark(bookmark)
  const isMediaAsset = isImage || isPdf

  // Browsers report a normal load even when a site forbids framing, so ask the server first for generic websites.
  const embedCheck = useQuery({
    queryKey: ["/v1/bookmarks/embeddable", website?.href],
    queryFn: async () => {
      const response = await AXIOS_INSTANCE.get("/v1/bookmarks/embeddable", { params: { url: website?.href } })
      return Boolean(response.data?.data?.embeddable ?? response.data?.embeddable ?? true)
    },
    enabled: !!website && !youtubeEmbedUrl && !isMediaAsset,
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
  })

  const blocked = !youtubeEmbedUrl && !isMediaAsset && embedCheck.data === false
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [showSummary, setShowSummary] = useState(false)
  const thumbnail = getProxiedImageUrl(bookmark.imageUrl)
  const [thumbnailFailed, setThumbnailFailed] = useState(false)
  const unavailable = status === "error"
  const showReference = unavailable || showSummary
  const showFrame = !isMediaAsset && !!website && !showReference && (!!youtubeEmbedUrl || !embedCheck.isPending)

  useEffect(() => {
    if (isMediaAsset) return
    // A direct frame load clears the spinner; a proxied frame waits for the proxy to confirm rendered content.
    if (!showFrame || (blocked ? contentConfirmed : status !== "loading")) return
    const timeout = window.setTimeout(() => setStatus("error"), 15000)
    return () => window.clearTimeout(timeout)
  }, [showFrame, blocked, contentConfirmed, status, reload, frameUrl, isMediaAsset])

  useEffect(() => {
    if (isMediaAsset || !blocked || !showFrame) return
    const onMessage = (event: MessageEvent) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return
      const data = event.data as { type?: unknown; url?: unknown; reason?: unknown } | null
      if (data?.type === PREVIEW_ERROR_MESSAGE) {
        setSiteBlocked(data.reason === "blocked")
        setStatus("error")
      }
      if (data?.type === PREVIEW_READY_MESSAGE) {
        setContentConfirmed(true)
        setStatus("loaded")
      }
      if (data?.type === PREVIEW_NAVIGATE_MESSAGE && typeof data.url === "string") {
        const next = safeHttpUrl(data.url)
        if (!next) return
        setStatus("loading")
        setContentConfirmed(false)
        setFrameUrl(next.href)
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [blocked, showFrame, isMediaAsset])

  const mediaSourceUrl = bookmark.url || bookmark.imageUrl || ""

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[94dvh] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[calc(100%-3rem)]"
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
          if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable], [aria-label="Bookmark inspector"], [role="combobox"], [role="menu"], [role="listbox"]')) return
          const navigate = event.key === "ArrowLeft" ? onPrevious : event.key === "ArrowRight" ? onNext : undefined
          if (navigate) {
            event.preventDefault()
            navigate()
          }
        }}
      >
        <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-4 py-3 sm:gap-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate">
              {bookmark.title || (isPdf ? "PDF Document" : isImage ? "Image preview" : website?.hostname || "Website preview")}
            </DialogTitle>
            <DialogDescription className="truncate">
              {isPdf ? "PDF Document" : isImage ? "Image" : website?.hostname || "Invalid website URL"}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-1" aria-label="Bookmark navigation">
            <Button variant="ghost" size="icon-sm" aria-label="Previous item (Left arrow)" title="Previous (←)" disabled={!onPrevious} onClick={onPrevious}>
              <CaretLeft />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next item (Right arrow)" title="Next (→)" disabled={!onNext} onClick={onNext}>
              <CaretRight />
            </Button>
          </div>
          {showFrame && !showSummary && (
            <Button variant="ghost" size="icon-sm" aria-label="Reload website" title="Reload" onClick={() => { setStatus("loading"); setContentConfirmed(false); setReload((value) => value + 1) }}>
              <ArrowClockwise />
            </Button>
          )}
          {isMediaAsset && mediaSourceUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={mediaSourceUrl} download={bookmark.title || (isPdf ? "document.pdf" : "image")}>
                <DownloadSimple data-icon="inline-start" />
                Download
              </a>
            </Button>
          )}
          {website && (
            <Button size="sm" asChild>
              <a href={website.href} target="_blank" rel="noopener noreferrer">
                <ArrowSquareOut data-icon="inline-start" />
                Open original
              </a>
            </Button>
          )}
          {inspector && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={showDetails ? "Hide details panel" : "Show details panel"}
              title={showDetails ? "Hide details" : "Show details"}
              aria-expanded={showDetails}
              aria-pressed={showDetails}
              onClick={onToggleDetails}
              className="aria-pressed:bg-muted aria-pressed:text-foreground"
            >
              {/* Mirrored so the highlighted panel sits on the right, where the details open. */}
              <SidebarSimple className="-scale-x-100" weight={showDetails ? "fill" : "regular"} />
            </Button>
          )}
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close preview" title="Close (Esc)">
              <X />
            </Button>
          </DialogClose>
        </header>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {isImage ? (
              <ImageViewer src={mediaSourceUrl} title={bookmark.title} />
            ) : isPdf ? (
              <PdfViewer url={mediaSourceUrl} title={bookmark.title} />
            ) : (
              <>
                {website && !youtubeEmbedUrl && embedCheck.isPending && (
                  <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground" role="status">
                    <Spinner aria-hidden="true" /> Preparing preview…
                  </div>
                )}
                {showFrame && (
                  <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2 text-xs text-muted-foreground">
                    {status === "loading" && <span role="status" className="flex items-center gap-2"><Spinner aria-hidden="true" /> Loading website…</span>}
                    {/* Cross-origin frames can report a load even when their content is blank. */}
                    <Button variant="link" size="xs" onClick={() => setShowSummary(true)}>Show saved details instead</Button>
                  </div>
                )}
                {website && showReference && (
                  <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto bg-muted/30 p-4 sm:items-center">
                    <Card role="region" aria-label="Saved details" className="w-full max-w-xl shrink-0">
                      {thumbnail && !thumbnailFailed && (
                        <img
                          src={thumbnail}
                          alt=""
                          onError={() => setThumbnailFailed(true)}
                          className="aspect-[1.91/1] w-full border-b border-border bg-muted object-cover"
                        />
                      )}
                      <CardHeader className="gap-1 p-4">
                        <CardTitle className="line-clamp-2 break-words">{bookmark.title || website.hostname}</CardTitle>
                        <CardDescription>{website.hostname}</CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col items-start gap-3 px-4 pb-4">
                        {unavailable && (
                          <p className="text-sm text-muted-foreground">
                            {siteBlocked
                              ? `${website.hostname} blocks previews from other apps, so it can only be read on the original site.`
                              : "This preview could not be loaded. Open the original to read it."}
                          </p>
                        )}
                        <p className="line-clamp-4 text-sm">{bookmark.description || "No description saved for this link."}</p>
                        {siteBlocked && !bookmark.description && (
                          <p className="text-xs text-muted-foreground">Saving this page with the Cabinet browser extension keeps its title, description, and image.</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button asChild><a href={website.href} target="_blank" rel="noopener noreferrer"><ArrowSquareOut data-icon="inline-start" />Open original</a></Button>
                          {!siteBlocked && <Button variant="outline" onClick={() => { setShowSummary(false); setStatus("loading"); setContentConfirmed(false); setReload((value) => value + 1) }}>Try the live preview</Button>}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
                {showFrame && (
                  <div className="relative flex min-h-0 flex-1 flex-col">
                    <iframe
                      key={reload}
                      ref={frameRef}
                      src={youtubeEmbedUrl ?? (blocked ? getProxiedPageUrl(frameUrl ?? website.href) : website.href)}
                      title={bookmark.title || website.hostname}
                      // A proxied page can render and then break while its scripts start, so keep it hidden until the proxy confirms it.
                      className={cn("min-h-0 w-full flex-1 border-0 bg-white", blocked && !contentConfirmed && "invisible")}
                      sandbox={blocked ? PROXIED_FRAME_SANDBOX : DIRECT_FRAME_SANDBOX}
                      referrerPolicy={youtubeEmbedUrl ? "strict-origin-when-cross-origin" : "no-referrer"}
                      allow={youtubeEmbedUrl ? "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" : undefined}
                      onLoad={() => { if (!blocked) setStatus("loaded") }}
                      onError={() => { setStatus("error"); setShowSummary(true) }}
                      allowFullScreen
                    />
                    {blocked && !contentConfirmed && (
                      <div className="absolute inset-0 flex items-center justify-center bg-muted/30 text-muted-foreground" aria-hidden="true">
                        <Spinner />
                      </div>
                    )}
                  </div>
                )}
                {!website && <p role="alert" className="p-6">Only valid HTTP and HTTPS websites can be previewed.</p>}
              </>
            )}
          </section>
          {inspector && (
            <div hidden={!showDetails} className="h-[42%] min-h-0 shrink-0 overflow-y-auto border-t lg:h-full lg:w-96 lg:border-t-0 lg:border-l">
              {inspector}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

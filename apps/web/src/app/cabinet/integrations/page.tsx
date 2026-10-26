"use client"

import React, { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  UploadSimple,
  DownloadSimple,
  GoogleChromeLogo,
  AppleLogo,
  Browsers,
  PuzzlePiece,
  CheckCircle,
  FileHtml,
  Compass,
} from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Spinner } from "@/components/ui/spinner"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { readBookmarkImport } from "@/lib/import-bookmarks"
import { toast } from "@/components/ui/sonner"
import { AXIOS_INSTANCE, useBookmarksControllerImport } from "@/lib/api-client"
import {
  PipelineDiagram,
  ChromeExportIllustration,
  SafariExportIllustration,
  ExtensionWorkflowIllustration,
} from "./integrations-diagrams"

export default function IntegrationsPage() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [guide, setGuide] = useState("chrome")
  const [queuedTask, setQueuedTask] = useState<string | null>(null)
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab")
    if (requested && ["chrome", "safari", "raindrop", "arc-brave", "extension"].includes(requested)) setGuide(requested)
  }, [])
  const importMutation = useBookmarksControllerImport()
  const [isImporting, setIsImporting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const handleImportFile = async (file?: File | null) => {
    if (!file || isImporting) return
    if (!file.name.toLowerCase().endsWith(".html") && !file.name.toLowerCase().endsWith(".htm")) {
      toast.error("Pilih berkas HTML bookmark standar (misal: bookmarks.html).")
      return
    }

    setIsImporting(true)
    const toastId = toast.loading(`Mengimpor "${file.name}" ke Cabinet...`)
    try {
      const htmlContent = await readBookmarkImport(file)
      const res: any = await importMutation.mutateAsync({ data: { htmlContent } })
      for (const queryKey of [["/v1/bookmarks"], ["infinite", "/v1/bookmarks"], ["/v1/folders"], ["/v1/tags"]]) {
        queryClient.invalidateQueries({ queryKey })
      }
      const task = res?.data ?? res
      if (!task?.id) throw new Error("Server tidak mengembalikan status impor.")
      setQueuedTask(task.id)
      queryClient.invalidateQueries({ queryKey: ["activity-overview"] })
      toast.success("Impor masuk antrean. Anda boleh meninggalkan halaman ini.", { id: toastId, action: { label: "Lihat progres", onClick: () => router.push("/cabinet/activity") } })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memulai impor. Pastikan format berkas valid.", { id: toastId })
    } finally {
      setIsImporting(false)
    }
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
      toast.success("Berkas bookmark HTML berhasil diunduh.")
    } catch {
      toast.error("Gagal mengekspor bookmark.")
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-8 px-4 py-6 sm:px-8 sm:py-10">
      {/* Navigation Header */}
      <header className="flex flex-col gap-5 border-b border-border/80 pb-6">
        <Link
          href="/cabinet"
          className="inline-flex min-h-10 w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft /> Kembali ke Cabinet
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Integrations &amp; Connections
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Panduan lengkap memindahkan bookmark dari Google Chrome, Apple Safari, Raindrop, dan browser lainnya ke Cabinet tanpa kehilangan struktur folder.
          </p>
        </div>
      </header>

      {queuedTask && <Alert><AlertTitle>Impor sedang diproses di latar belakang</AlertTitle><AlertDescription>Bookmark yang sudah tersimpan tetap aman jika proses perlu diulang. <Link href="/cabinet/activity" className="underline underline-offset-4">Lihat progres dan status impor</Link></AlertDescription></Alert>}
      {/* Direct Interactive Dropzone Area */}
      <section aria-labelledby="quick-import-heading" className="flex flex-col gap-3">
        <h2 id="quick-import-heading" className="text-base font-medium text-foreground">
          Impor Berkas Bookmark Sekarang
        </h2>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const file = e.dataTransfer.files?.[0]
            void handleImportFile(file)
          }}
          className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors sm:p-10 ${
            dragOver
              ? "border-library-olive bg-library-highlight/40 dark:bg-library-olive/10"
              : "border-border bg-card hover:bg-muted/30"
          }`}
        >
          <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-foreground">
            {isImporting ? <Spinner /> : <FileHtml className="size-6 text-muted-foreground" />}
          </div>
          <div className="mt-4 flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              {isImporting ? "Sedang memproses impor bookmark..." : "Tarik dan lepas berkas HTML bookmark ke sini"}
            </p>
            <p className="text-xs text-muted-foreground">
              Mendukung format HTML standar dari Chrome, Safari, Raindrop.io, Arc, Firefox, Edge, dan Brave.
            </p>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <label className="relative cursor-pointer">
              <Button asChild variant="default" disabled={isImporting}>
                <span>
                  <UploadSimple data-icon="inline-start" />
                  {isImporting ? "Mengimpor…" : "Pilih Berkas HTML"}
                </span>
              </Button>
              <input
                type="file"
                accept=".html,.htm"
                aria-label="Pilih berkas HTML bookmark untuk diimpor"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  void handleImportFile(file)
                  e.target.value = ""
                }}
                disabled={isImporting}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </label>

            <Button
              variant="outline"
              disabled={isExporting}
              onClick={handleExport}
              title="Unduh cadangan seluruh bookmark Anda dalam format HTML"
            >
              {isExporting ? <Spinner /> : <DownloadSimple data-icon="inline-start" />}
              {isExporting ? "Menyiapkan…" : "Ekspor dari Cabinet"}
            </Button>
          </div>
        </div>
      </section>

      {/* Pipeline Diagram Illustration */}
      <section aria-labelledby="pipeline-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="pipeline-heading" className="text-base font-medium text-foreground">
            Alur Kerja Impor &amp; Ekspor
          </h2>
          <p className="text-xs text-muted-foreground">
            Cabinet menggunakan format terbuka Netscape Bookmarks sehingga data Anda tidak terkunci di satu aplikasi.
          </p>
        </div>
        <PipelineDiagram />
      </section>

      {/* Platform-by-Platform Guides */}
      <section aria-labelledby="guides-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="guides-heading" className="text-base font-medium text-foreground">
            Panduan Berdasarkan Aplikasi Asal
          </h2>
          <p className="text-xs text-muted-foreground">
            Pilih browser atau aplikasi penanda buku yang sedang Anda gunakan untuk melihat langkah spesifiknya.
          </p>
        </div>

        <Tabs value={guide} onValueChange={setGuide} className="flex flex-col gap-5">
          <div className="overflow-x-auto pb-1">
            <TabsList className="h-10 w-max min-w-full justify-start gap-1 p-1">
              <TabsTrigger value="chrome" className="gap-2 text-xs">
                <GoogleChromeLogo className="size-4" />
                Google Chrome
              </TabsTrigger>
              <TabsTrigger value="safari" className="gap-2 text-xs">
                <AppleLogo className="size-4" />
                Apple Safari
              </TabsTrigger>
              <TabsTrigger value="raindrop" className="gap-2 text-xs">
                <Compass className="size-4" />
                Raindrop.io
              </TabsTrigger>
              <TabsTrigger value="arc-brave" className="gap-2 text-xs">
                <Browsers className="size-4" />
                Arc &amp; Brave
              </TabsTrigger>
              <TabsTrigger value="extension" className="gap-2 text-xs">
                <PuzzlePiece className="size-4" />
                Ekstensi 1-Klik
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Chrome Tab */}
          <TabsContent value="chrome" className="flex flex-col gap-6">
            <Card>
              <CardHeader className="gap-1 p-5 sm:p-6">
                <CardTitle className="text-xl">Cara Ekspor dari Google Chrome</CardTitle>
                <CardDescription>
                  Chrome menyimpan bookmark dalam format HTML Netscape lengkap dengan tanggal dan hierarki folder.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6 p-5 pt-0 sm:p-6 sm:pt-0">
                <ChromeExportIllustration />
                <ol className="flex flex-col gap-3 text-sm text-foreground">
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">1</span>
                    <span>Buka Google Chrome di komputer Anda.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">2</span>
                    <span>
                      Klik ikon menu <strong>tiga titik vertikal (⋮)</strong> di sudut kanan atas jendela browser.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">3</span>
                    <span>
                      Arahkan ke <strong>Bookmarks and lists</strong> (Penanda dan daftar), lalu pilih <strong>Bookmark manager</strong> (Pengelola penanda).
                      Atau tekan pintasan cepat: <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">⌘⌥B</kbd> di Mac atau <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">Ctrl+Shift+O</kbd> di Windows.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">4</span>
                    <span>
                      Di bagian atas halaman Bookmark Manager (di samping bilah cari), klik tombol <strong>tiga titik (⋮)</strong> khusus manajer penanda.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">5</span>
                    <span>
                      Pilih <strong>Export bookmarks</strong> (Ekspor penanda) dan simpan berkas HTML yang dihasilkan di komputer Anda.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">6</span>
                    <span>
                      Unggah berkas tersebut ke area dropzone di atas halaman ini. Cabinet akan otomatis membuat folder yang sesuai dan mengimpor setiap tautan.
                    </span>
                  </li>
                </ol>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Safari Tab */}
          <TabsContent value="safari" className="flex flex-col gap-6">
            <Card>
              <CardHeader className="gap-1 p-5 sm:p-6">
                <CardTitle className="text-xl">Cara Ekspor dari Apple Safari</CardTitle>
                <CardDescription>
                  Safari di macOS memungkinkan ekspor seluruh penanda buku dan Reading List ke satu berkas HTML.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6 p-5 pt-0 sm:p-6 sm:pt-0">
                <SafariExportIllustration />
                <ol className="flex flex-col gap-3 text-sm text-foreground">
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">1</span>
                    <span>Buka Safari di Mac Anda.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">2</span>
                    <span>
                      Pada Menu Bar di bagian paling atas layar, klik menu <strong>File</strong> (Berkas).
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">3</span>
                    <span>
                      Pilih <strong>Export Bookmarks...</strong> (Ekspor Penanda...).
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">4</span>
                    <span>
                      Tentukan lokasi penyimpanan dan simpan berkas dengan nama <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">Safari Bookmarks.html</code>.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">5</span>
                    <span>
                      Tarik berkas HTML tersebut ke kotak impor di atas halaman ini.
                    </span>
                  </li>
                </ol>

                <div className="rounded-md border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Catatan untuk Safari iPhone &amp; iPad:</p>
                  <p className="mt-1 leading-relaxed">
                    Sistem iOS/iPadOS tidak menyediakan tombol ekspor berkas langsung demi keamanan sandbox. Jika Anda mengaktifkan <strong>iCloud Safari Sync</strong> di Pengaturan iPhone Anda, bookmark iPhone otomatis tersinkron ke Safari di Mac Anda, sehingga Anda bisa mengekspornya langsung dari Mac.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Raindrop Tab */}
          <TabsContent value="raindrop" className="flex flex-col gap-6">
            <Card>
              <CardHeader className="gap-1 p-5 sm:p-6">
                <CardTitle className="text-xl">Cara Ekspor dari Raindrop.io</CardTitle>
                <CardDescription>
                  Pindahkan bookmark, tag, dan struktur koleksi dari Raindrop ke Cabinet dengan mudah.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6 p-5 pt-0 sm:p-6 sm:pt-0">
                <ol className="flex flex-col gap-3 text-sm text-foreground">
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">1</span>
                    <span>Buka Raindrop.io di browser atau aplikasi desktop.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">2</span>
                    <span>
                      Klik ikon profil Anda atau buka <strong>Settings</strong> (Pengaturan).
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">3</span>
                    <span>
                      Pilih tab <strong>Backups</strong> (Cadangan) di bilah navigasi pengaturan.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">4</span>
                    <span>
                      Klik <strong>Export as HTML</strong> (Ekspor sebagai HTML). Berkas cadangan akan diunduh secara instan.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">5</span>
                    <span>
                      Tarik berkas HTML dari Raindrop ke area impor Cabinet. Semua folder koleksi Anda akan tetap utuh.
                    </span>
                  </li>
                </ol>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Arc & Brave Tab */}
          <TabsContent value="arc-brave" className="flex flex-col gap-6">
            <Card>
              <CardHeader className="gap-1 p-5 sm:p-6">
                <CardTitle className="text-xl">Cara Ekspor dari Arc, Brave, &amp; Firefox</CardTitle>
                <CardDescription>
                  Hampir seluruh browser modern menyediakan menu ekspor berkas bookmark HTML standar.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6 p-5 pt-0 sm:p-6 sm:pt-0">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-md border border-border bg-muted/20 p-4 text-xs">
                    <p className="font-semibold text-foreground">Arc Browser</p>
                    <p className="mt-1 text-muted-foreground leading-relaxed">
                      Tekan <kbd className="rounded border bg-background px-1 py-0.5">⌘T</kbd> lalu ketik <code className="font-mono">Export Bookmarks</code>, atau buka menu atas: <strong>Help</strong> &gt; <strong>Export Bookmarks</strong>. Simpan berkas HTML dan seret ke Cabinet.
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-4 text-xs">
                    <p className="font-semibold text-foreground">Brave Browser</p>
                    <p className="mt-1 text-muted-foreground leading-relaxed">
                      Klik menu garis tiga di kanan atas ➔ <strong>Bookmarks</strong> ➔ <strong>Bookmark manager</strong> ➔ klik tombol (⋮) di kanan atas halaman penanda ➔ pilih <strong>Export bookmarks</strong>.
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-4 text-xs">
                    <p className="font-semibold text-foreground">Mozilla Firefox</p>
                    <p className="mt-1 text-muted-foreground leading-relaxed">
                      Tekan <kbd className="rounded border bg-background px-1 py-0.5">⌘⇧O</kbd> (Mac) atau <kbd className="rounded border bg-background px-1 py-0.5">Ctrl+Shift+O</kbd> (Windows) untuk membuka Library. Pilih <strong>Import and Backup</strong> ➔ <strong>Export Bookmarks to HTML...</strong>.
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-4 text-xs">
                    <p className="font-semibold text-foreground">Pocket</p>
                    <p className="mt-1 text-muted-foreground leading-relaxed">
                      Masuk ke akun web Pocket ➔ Pengaturan Akun ➔ Buka bagian <strong>Privacy / Export Data</strong> ➔ Klik <strong>Export HTML file</strong> untuk mengunduh seluruh daftar bacaan Anda.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Extension 1-Click Tab */}
          <TabsContent value="extension" className="flex flex-col gap-6">
            <Card>
              <CardHeader className="gap-1 p-5 sm:p-6">
                <CardTitle className="text-xl">Simpan 1-Klik dengan Ekstensi Browser</CardTitle>
                <CardDescription>
                  Tidak ingin mengekspor berkas manual setiap saat? Gunakan ekstensi resmi Cabinet untuk Chrome.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6 p-5 pt-0 sm:p-6 sm:pt-0">
                <ExtensionWorkflowIllustration />
                <div className="flex flex-col gap-3 text-sm leading-6">
                  <h3 className="font-medium">Pasang ekstensi dari folder proyek</h3>
                  <p className="text-muted-foreground">Saat ini ekstensi dipasang manual, bukan dari Chrome Web Store. Gunakan folder <code>apps/extension</code> dari proyek Cabinet.</p>
                  <ol className="list-decimal pl-5">
                    <li>Buka <code>chrome://extensions</code> dan aktifkan Developer mode.</li>
                    <li>Pilih Load unpacked, lalu pilih folder <code>apps/extension</code>.</li>
                    <li>Buka Options ekstensi. Atur alamat aplikasi dan API sesuai server Cabinet Anda.</li>
                    <li>Masuk ke Cabinet, lalu simpan satu halaman melalui ekstensi. Langkah panduan selesai setelah halaman benar-benar tersimpan di akun.</li>
                  </ol>
                  <p className="text-muted-foreground">Jika tertulis Saved locally, data masih menunggu sinkronisasi. Jangan hapus penyimpanan ekstensi sebelum sinkronisasi selesai.</p>
                </div>
                <div className="flex flex-col gap-3 text-sm text-foreground">
                  <p className="leading-relaxed text-muted-foreground">
                    Ekstensi Cabinet membaca sesi aktif Anda langsung di browser. Anda dapat menyimpan halaman web apapun ke folder yang diinginkan atau menyimpan kutipan teks (highlight) dengan pintasan keyboard.
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-md border border-border bg-muted/30 p-3">
                      <span className="font-mono text-xs font-semibold text-foreground">⌘⇧S / Ctrl+Shift+S</span>
                      <p className="mt-1 text-xs text-muted-foreground">Buka popup simpan lengkap dengan pilihan folder dan tag.</p>
                    </div>
                    <div className="rounded-md border border-border bg-muted/30 p-3">
                      <span className="font-mono text-xs font-semibold text-foreground">⌥⇧S / Alt+Shift+S</span>
                      <p className="mt-1 text-xs text-muted-foreground">Simpan langsung ke folder terakhir tanpa membuka popup.</p>
                    </div>
                    <div className="rounded-md border border-border bg-muted/30 p-3">
                      <span className="font-mono text-xs font-semibold text-foreground">⌥⇧H / Alt+Shift+H</span>
                      <p className="mt-1 text-xs text-muted-foreground">Simpan teks yang sedang disorot sebagai kutipan catatan.</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>

      {/* Helpful Guarantees & FAQ */}
      <section aria-labelledby="faq-heading" className="flex flex-col gap-3 border-t border-border/80 pt-6">
        <h2 id="faq-heading" className="text-base font-medium text-foreground">
          Hal yang Perlu Diketahui Tentang Impor Cabinet
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <CheckCircle className="size-4 text-library-olive" /> Struktur Folder Terjaga
            </span>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Semua sub-folder dari Chrome atau Safari otomatis dipetakan menjadi hierarki folder di Cabinet tanpa mengubah susunan aslinya.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <CheckCircle className="size-4 text-library-olive" /> Pratinjau Gambar Otomatis
            </span>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Setelah berkas diimpor, server Cabinet secara bertahap mengambil gambar pratinjau dan deskripsi OpenGraph di latar belakang.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <CheckCircle className="size-4 text-library-olive" /> Pembersihan Duplikat
            </span>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Jika ada URL yang sama diimpor berulang kali, fitur deteksi duplikat di menu Pemeliharaan dapat merapikannya dalam satu klik.
            </p>
          </div>
        </div>
      </section>

      {/* Navigation Footer */}
      <footer className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="font-serif text-lg text-foreground">Cabinet</span>
          <span>· Integrations &amp; Connections Guide</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/cabinet/settings" className="hover:text-foreground">
            Buka Pengaturan
          </Link>
          <Link href="/cabinet" className="hover:text-foreground">
            Ke Pustaka
          </Link>
        </div>
      </footer>
    </main>
  )
}

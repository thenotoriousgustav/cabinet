import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"
import { build } from "esbuild"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

const directory = await mkdtemp(join(process.cwd(), ".moodboard-card-test-"))
let MoodboardCard
try {
  const result = await build({
    entryPoints: ["src/app/cabinet/components/bookmark-moodboard-view.tsx"],
    bundle: true,
    jsx: "automatic",
    platform: "node",
    format: "esm",
    packages: "external",
    external: ["react"],
    write: false,
  })
  const file = join(directory, "card.mjs")
  await writeFile(file, result.outputFiles[0].text)
  ;({ MoodboardCard } = await import(pathToFileURL(file).href))
} finally {
  await rm(directory, { recursive: true, force: true })
}

const noop = () => {}
const render = (bookmark, density, isSelected = false) => renderToStaticMarkup(React.createElement(MoodboardCard, {
  showActions: false,
  nativeDrag: false,
  displayPreferences: { density, showTitle: true, showDescription: true, showImage: true, showWebsite: true, showFolder: true, showDate: true },
  bookmark: { id: "card", userId: "owner", canEdit: true, folderId: "folder", createdAt: "2026-10-18T10:00:00Z", tags: [{ id: "design", name: "design" }], metadataStatus: "COMPLETED", ...bookmark },
  folders: [{ id: "folder", name: "Design references" }],
  isSelected, onToggleSelect: noop, onSelectTag: noop, onToggleFavorite: noop, onToggleArchive: noop,
  onEditBookmark: noop, onDeleteBookmark: noop, onDuplicateBookmark: noop,
  getHostname: (url) => (url ? new URL(url).hostname : ""),
}))

const link = { title: "Japanese Design Since 1945", url: "https://www.example.com/book", description: "A complete sourcebook.", imageUrl: "https://cdn.example.com/cover.jpg" }

test("visual cards show the preview with only the title as a caption", () => {
  const html = render(link, "visual")
  assert.match(html, /<img[^>]+alt="Japanese Design Since 1945"/)
  assert.match(html, /Japanese Design Since 1945<\/p>/)
  for (const detail of [/A complete sourcebook/, /Design references/, /#design/, /<time/]) assert.doesNotMatch(html, detail)
})

test("PDF cards use the loaded document page ratio instead of a fixed frame", () => {
  for (const density of ["visual", "comfortable"]) {
    const html = render({ ...link, url: "https://cdn.example.com/document.pdf" }, density)
    assert.match(html, /style="aspect-ratio:1\.6"/)
  }
})

test("selected visual cards keep their olive outline inside the preview edge", () => {
  const html = render(link, "visual", true)
  assert.match(html, /ring-2 ring-inset ring-library-olive/)
})

test("hidden thumbnails load eagerly so onLoad can reveal them", () => {
  for (const density of ["visual", "compact", "comfortable"]) {
    const html = render(link, density)
    const image = html.match(/<img\b[^>]*>/)?.[0]
    assert.ok(image, `Missing thumbnail for ${density}`)
    assert.match(image, /loading="eager"/)
    assert.match(image, /decoding="async"/)
  }
})

test("visual links without a picture set the site and title as a type-only card", () => {
  const html = render({ ...link, imageUrl: null, siteName: "Forbes" }, "visual")
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /font-serif[^"]*">Forbes</)
  assert.match(html, /<p[^>]*>Japanese Design Since 1945</)
  // Type-only links use the same caption row as image cards.

  // When title equals hostname (e.g. "docs.google.com" at root), do not duplicate it twice.
  const rootDomain = render({ ...link, title: "docs.google.com", url: "https://docs.google.com/", imageUrl: null, siteName: null }, "visual")
  assert.equal(rootDomain.match(/docs\.google\.com</g).length, 1)
  assert.match(rootDomain, /<p[^>]*>docs\.google\.com</)

  // When title equals hostname on a deep link, show the URL path instead of repeating the domain.
  const deepDomain = render({ ...link, title: "medium.com", url: "https://medium.com/@author/tiptap-vs-lexical", imageUrl: null, siteName: null }, "visual")
  assert.match(deepDomain, /medium\.com</)
  assert.match(deepDomain, /<p[^>]*>@author\/tiptap-vs-lexical</)
})

test("visual cards flag broken links and keep note titles reachable", () => {
  assert.match(render({ ...link, status: "BROKEN" }, "visual"), /text-destructive[^"]*">Broken/)
  const note = render({ type: "NOTE", title: "Reading list", notes: "Look for clear hierarchy and readable text.", url: null }, "visual")
  assert.match(note, /Look for clear hierarchy/)
  assert.match(note, /<button type="button"[^>]*>Reading list<\/button>/)
})

test("comfortable and compact cards keep their full details", () => {
  for (const density of ["comfortable", "compact"]) {
    const html = render(link, density)
    for (const detail of [/A complete sourcebook/, /Design references/, /#design/, /<time/]) assert.match(html, detail)
  }
})

import assert from "node:assert/strict"
import test from "node:test"
import { canDownloadMedia, isVideoBookmark } from "../src/lib/bookmark-kind.ts"

test("video detection only matches actual video URLs", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=abc",
    "https://youtu.be/abc",
    "https://vimeo.com/12345",
    "https://www.tiktok.com/@a/video/123",
    "https://www.instagram.com/reel/abc/",
  ]) assert.equal(isVideoBookmark({ url }), true, url)

  for (const url of [
    "https://x.com/someone/status/1",
    "https://twitter.com/someone",
    "https://www.instagram.com/someone/",
    "https://www.youtube.com/@channel",
    "https://example.com/x.com",
    "https://netflix.com",
  ]) assert.equal(isVideoBookmark({ url }), false, url)
})

test("server-classified videos are trusted", () => {
  assert.equal(isVideoBookmark({ url: "https://example.com/clip", contentType: "VIDEO" }), true)
})

test("X posts can still offer media download without being labeled video", () => {
  assert.equal(canDownloadMedia({ url: "https://x.com/a/status/123" }), true)
  assert.equal(canDownloadMedia({ url: "https://x.com/a" }), false)
})

test("drawings open in their own editor and are not mistaken for notes", async () => {
  const { editorPath, isNoteBookmark, isDrawingBookmark } = await import("../src/lib/bookmark-kind.ts")
  assert.equal(isNoteBookmark({ type: "DRAWING", url: null }), false)
  assert.equal(isDrawingBookmark({ type: "DRAWING" }), true)
  assert.equal(isNoteBookmark({ url: null }), true)
  assert.equal(editorPath({ id: "d1", type: "DRAWING" }), "/cabinet/drawings/d1")
  assert.equal(editorPath({ id: "n1", type: "NOTE" }), "/cabinet/notes/n1")
  assert.equal(editorPath({ id: "b1", type: "BOOKMARK", url: "https://example.com" }), null)
})

test("item access falls back to the older canEdit flag", async () => {
  const { itemAccess } = await import("../src/lib/bookmark-kind.ts")
  assert.equal(itemAccess({ access: "editor", canEdit: false }), "editor")
  assert.equal(itemAccess({ canEdit: false }), "viewer")
  assert.equal(itemAccess({}), "owner")
})

test("highlights are notes on a page that open with a quote", async () => {
  const { highlightQuote } = await import("../src/lib/bookmark-kind.ts")
  const doc = (first) => ({ type: "doc", content: [first, { type: "paragraph", content: [{ type: "text", text: "Source" }] }] })
  const quote = { type: "blockquote", content: [
    { type: "paragraph", content: [{ type: "text", text: "Line one" }, { type: "hardBreak" }, { type: "text", text: "line two" }] },
    { type: "paragraph", content: [{ type: "text", text: " Second " }] },
  ] }
  assert.equal(highlightQuote({ type: "NOTE", url: "https://example.com/a", noteDocument: doc(quote) }), "Line one\nline two\n\nSecond")
  assert.equal(highlightQuote({ type: "NOTE", url: "https://example.com/a", noteDocument: JSON.stringify(doc(quote)) }), "Line one\nline two\n\nSecond")
  // A note without a page, a note that opens with text, and links are not highlights.
  assert.equal(highlightQuote({ type: "NOTE", url: null, noteDocument: doc(quote) }), null)
  assert.equal(highlightQuote({ type: "NOTE", url: "https://example.com/a", noteDocument: doc({ type: "paragraph", content: [{ type: "text", text: "x" }] }) }), null)
  assert.equal(highlightQuote({ type: "BOOKMARK", url: "https://example.com/a", noteDocument: doc(quote) }), null)
  assert.equal(highlightQuote({ type: "NOTE", url: "https://example.com/a", noteDocument: "{broken" }), null)
})

test("pdf and image detection matches content type and file extensions", async () => {
  const { isPdfBookmark, isImageBookmark } = await import("../src/lib/bookmark-kind.ts")
  assert.equal(isPdfBookmark({ url: "https://example.com/doc.pdf" }), true)
  assert.equal(isPdfBookmark({ url: "https://example.com/item", contentType: "PDF" }), true)
  assert.equal(isPdfBookmark({ url: "https://example.com/not-pdf" }), false)

  assert.equal(isImageBookmark({ url: "https://example.com/pic.png" }), true)
  assert.equal(isImageBookmark({ url: "https://example.com/pic.jpg" }), true)
  assert.equal(isImageBookmark({ url: "https://example.com/pic.webp" }), true)
  assert.equal(isImageBookmark({ url: "https://example.com/item", contentType: "IMAGE" }), true)
  assert.equal(isImageBookmark({ url: "https://example.com/page.html" }), false)
})

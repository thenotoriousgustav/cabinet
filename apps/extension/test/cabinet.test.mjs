import assert from "node:assert/strict"
import test from "node:test"
import { api, setWorkerSave, MAX_HIGHLIGHT_LENGTH, canonicalUrl, cleanMetadata, cleanTags, highlightDocument, saveBookmark, saveHighlight, saveableUrl, trimSlash } from "../src/cabinet.js"

test("only web pages can be saved", () => {
  assert.equal(saveableUrl("https://example.com/a"), "https://example.com/a")
  for (const url of ["chrome://extensions", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "about:blank", "not a url"]) {
    assert.equal(saveableUrl(url), null, url)
  }
})

test("duplicate matching ignores the fragment and a trailing slash, like the web app", () => {
  assert.equal(canonicalUrl("https://example.com/read/#part"), "https://example.com/read")
  assert.equal(canonicalUrl("https://example.com/"), "https://example.com")
  assert.equal(canonicalUrl("chrome://newtab"), null)
})

test("tags are trimmed, lowercased, deduplicated, and stripped of a leading #", () => {
  assert.deepEqual(cleanTags(" #Design, design ,UX,, "), ["design", "ux"])
  assert.deepEqual(cleanTags(["Read later", "#read later"]), ["read later"])
  assert.equal(cleanTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 20)
})

test("addresses lose their trailing slashes", () => {
  assert.equal(trimSlash(" http://localhost:4000// "), "http://localhost:4000")
})

test("a highlight is a quote with a link back to its page", () => {
  const doc = highlightDocument({ text: "  First line\r\nsame paragraph  \n\n\nSecond paragraph ", url: "https://example.com/a", title: "An article" })
  assert.deepEqual(doc, {
    type: "doc",
    content: [
      { type: "blockquote", content: [
        { type: "paragraph", content: [{ type: "text", text: "First line" }, { type: "hardBreak" }, { type: "text", text: "same paragraph" }] },
        { type: "paragraph", content: [{ type: "text", text: "Second paragraph" }] },
      ] },
      { type: "paragraph", content: [{ type: "text", text: "An article", marks: [{ type: "link", attrs: { href: "https://example.com/a" } }] }] },
    ],
  })
  // Without a page title the source link reads as the site.
  assert.equal(highlightDocument({ text: "x", url: "https://www.example.com/a" }).content[1].content[0].text, "example.com")
  assert.equal(highlightDocument({ text: "y".repeat(MAX_HIGHLIGHT_LENGTH + 50), url: "https://example.com" }).content[0].content[0].content[0].text.length, MAX_HIGHLIGHT_LENGTH)
  assert.throws(() => highlightDocument({ text: "  \n ", url: "https://example.com" }), /Select some text/)
})

test("saving a highlight posts a note on the page to the chosen folder", async () => {
  const requests = []
  const realFetch = globalThis.fetch
  globalThis.chrome = { storage: { sync: { get: async (defaults) => defaults } } }
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init })
    return new Response(JSON.stringify({ success: true, data: { id: "h1" } }), { status: 201 })
  }
  try {
    setWorkerSave((body) => api("/v1/bookmarks", { method: "POST", body }))
    assert.deepEqual(await saveHighlight({ text: "Quote", url: "https://example.com/a", title: " Article ", folderId: "f1" }), { id: "h1" })
    assert.equal(requests[0].url, "http://localhost:4000/v1/bookmarks")
    assert.equal(requests[0].init.credentials, "include")
    const body = JSON.parse(requests[0].init.body)
    assert.deepEqual({ ...body, noteDocument: undefined }, { type: "NOTE", url: "https://example.com/a", title: "Article", folderId: "f1", noteDocument: undefined })
    assert.equal(body.noteDocument.content[0].type, "blockquote")
    await assert.rejects(saveHighlight({ text: "Quote", url: "chrome://newtab" }), /web pages/)
  } finally {
    setWorkerSave(undefined)
    delete globalThis.chrome
    globalThis.fetch = realFetch
  }
})

test("page metadata keeps web addresses resolved against the page and trims text", () => {
  assert.deepEqual(cleanMetadata({
    description: "  A summary  ",
    imageUrl: "/cover.png",
    faviconUrl: "javascript:alert(1)",
    siteName: "",
    baseUrl: "https://medium.com/@a/post",
  }), { description: "A summary", imageUrl: "https://medium.com/cover.png" })
  assert.equal(cleanMetadata({ description: "x".repeat(2000) }).description.length, 1000)
  assert.deepEqual(cleanMetadata(null), {})
  assert.deepEqual(cleanMetadata({ contentType: "ARTICLE" }), { contentType: "ARTICLE" })
  assert.deepEqual(cleanMetadata({ contentType: "UNTRUSTED_VALUE" }), {})
})

test("saving a bookmark sends the page's metadata, with a typed description taking priority", async () => {
  const requests = []
  const realFetch = globalThis.fetch
  globalThis.chrome = { storage: { sync: { get: async (defaults) => defaults } } }
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ success: true, data: { id: "b1" } }), { status: 201 })
  }
  try {
    setWorkerSave((body) => api("/v1/bookmarks", { method: "POST", body }))
    const metadata = { description: "From page", imageUrl: "https://cdn.example.com/a.png", siteName: "Medium" }
    await saveBookmark({ url: "https://medium.com/@a/post", title: "Post", metadata })
    assert.deepEqual(requests[0], {
      type: "BOOKMARK", url: "https://medium.com/@a/post", title: "Post", description: "From page",
      imageUrl: "https://cdn.example.com/a.png", siteName: "Medium", tags: [],
    })
    await saveBookmark({ url: "https://medium.com/@a/post", description: "Mine", metadata })
    assert.equal(requests[1].description, "Mine")
  } finally {
    setWorkerSave(undefined)
    delete globalThis.chrome
    globalThis.fetch = realFetch
  }
})

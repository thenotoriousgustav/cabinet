import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"
import { build } from "esbuild"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// Render the preview without the portal; production keeps the real Radix dialog.
const directory = await mkdtemp(join(process.cwd(), ".webview-test-"))
let BookmarkWebview
try {
  const result = await build({
    entryPoints: ["src/app/cabinet/components/bookmark-webview.tsx"],
    bundle: true,
    jsx: "automatic",
    platform: "node",
    format: "esm",
    packages: "external",
    external: ["react"],
    write: false,
    plugins: [{
      name: "dialog-without-portal",
      setup(builder) {
        builder.onResolve({ filter: /^@\/components\/ui\/(dialog|button)$/ }, ({ path }) => ({ path, namespace: "test-ui" }))
        builder.onLoad({ filter: /.*/, namespace: "test-ui" }, () => ({
          contents: `import React from 'react';
            export const Dialog = ({children}) => children;
            export const DialogContent = ({children}) => React.createElement('section', null, children);
            export const DialogClose = ({children}) => children;
            export const DialogTitle = ({children}) => React.createElement('h2', null, children);
            export const DialogDescription = ({children}) => React.createElement('p', null, children);
            export const Button = ({children}) => children;`,
          loader: "js",
        }))
      },
    }],
  })
  const file = join(directory, "preview.mjs")
  await writeFile(file, result.outputFiles[0].text)
  ;({ BookmarkWebview } = await import(pathToFileURL(file).href))
} finally {
  await rm(directory, { recursive: true, force: true })
}

// Seed the embeddability answer the server would give for this URL.
const render = (url, embeddable, extra = {}) => {
  const client = new QueryClient()
  if (embeddable !== undefined) client.setQueryData(["/v1/bookmarks/embeddable", new URL(url).href], embeddable)
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client },
    React.createElement(BookmarkWebview, { bookmark: { id: "preview", title: "Example", url, ...extra }, onClose() {} })))
}

test("webview embeds websites that allow framing, with sandbox and an external fallback", () => {
  const html = render("https://example.com/article", true)
  assert.match(html, /<iframe[^>]+src="https:\/\/example.com\/article"/)
  assert.match(html, /sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"/)
  assert.match(html, /referrerPolicy="no-referrer"/)
  assert.doesNotMatch(html, /allow-top-navigation/)
  assert.match(html, /Open original/)
  assert.match(html, /Loading website/)
  assert.match(html, /Bookmark navigation/)
  assert.match(html, /Show saved details instead/)
})

test("webview still tries the sandboxed proxy when direct framing is blocked", () => {
  for (const host of ["skills.sh", "www.skills.sh", "www.reddit.com", "shopee.co.id"]) {
    const html = render(`https://${host}/article`, false)
    assert.match(html, /<iframe[^>]+src="http:\/\/localhost:4000\/v1\/bookmarks\/proxy-page\?url=/)
    assert.match(html, /sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"/)
    assert.doesNotMatch(html, /allow-same-origin/)
    assert.doesNotMatch(html, /aria-label="Saved details"/)
    assert.match(html, /Show saved details instead/)
    assert.match(html, /Open original/)
  }
})

test("saved details and proxied pages go through the API", async () => {
  const { getProxiedImageUrl } = await import("../src/lib/bookmark-image.ts")
  const { getProxiedPageUrl } = await import("../src/lib/bookmark-page.ts")
  assert.equal(getProxiedImageUrl("https://cdn.example.com/a.jpg"), "http://localhost:4000/v1/bookmarks/proxy-image?v=2&url=https%3A%2F%2Fcdn.example.com%2Fa.jpg")
  assert.equal(getProxiedPageUrl("https://skills.sh/a?b=1&c=2"), "http://localhost:4000/v1/bookmarks/proxy-page?url=https%3A%2F%2Fskills.sh%2Fa%3Fb%3D1%26c%3D2&v=2")
})

test("webview embeds YouTube videos directly with the official player without waiting for the framing check", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=dVFiXhUKXmI",
    "https://youtu.be/dVFiXhUKXmI?t=30",
    "https://www.youtube.com/shorts/dVFiXhUKXmI",
    "https://www.youtube.com/live/dVFiXhUKXmI",
    "https://www.youtube.com/embed/dVFiXhUKXmI",
  ]) {
    const html = render(url)
    assert.match(html, /<iframe[^>]+src="https:\/\/www\.youtube\.com\/embed\/dVFiXhUKXmI"/)
    assert.match(html, /referrerPolicy="strict-origin-when-cross-origin"/)
    assert.match(html, /allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"/)
    assert.doesNotMatch(html, /proxy-page|Preparing preview/)
    assert.match(html, /Open original/)
  }
})

test("webview waits for the framing check before loading the site", () => {
  const html = render("https://example.com/article")
  assert.doesNotMatch(html, /<iframe/)
  assert.match(html, /Preparing preview/)
})

test("webview renders dedicated image viewer with zoom and download for image bookmarks", () => {
  const html = render("https://example.com/photo.png", undefined, { contentType: "IMAGE" })
  assert.match(html, /<img[^>]+src="https:\/\/example\.com\/photo\.png"/)
  assert.match(html, /Download/)
  assert.match(html, /100%/)
  assert.match(html, /Open original/)
  assert.doesNotMatch(html, /<iframe/)
  assert.doesNotMatch(html, /Preparing preview/)
})

test("webview renders custom pdf canvas viewer with scroll modes and download", () => {
  const html = render("https://example.com/document.pdf", undefined, { contentType: "PDF" })
  assert.match(html, /<canvas/)
  assert.match(html, /Continuous/)
  assert.match(html, /Single page/)
  assert.match(html, /Download/)
  assert.match(html, /Open original/)
  assert.doesNotMatch(html, /<object/)
  assert.doesNotMatch(html, /<iframe/)
  assert.doesNotMatch(html, /Preparing preview/)
})

test("webview rejects executable, local-file, and malformed URLs", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,hello", "file:///etc/passwd", "invalid"]) {
    const client = new QueryClient()
    const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client },
      React.createElement(BookmarkWebview, { bookmark: { id: "preview", title: "Example", url }, onClose() {} })))
    assert.doesNotMatch(html, /<iframe/)
    assert.match(html, /Only valid HTTP and HTTPS/)
  }
})

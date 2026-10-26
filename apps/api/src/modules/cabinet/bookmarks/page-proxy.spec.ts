import { runInNewContext } from "node:vm"
import {
  decodeHtml,
  isHtmlContentType,
  proxiedPageHeaders,
  isBlockedResponse,
  proxyErrorPage,
  rewriteProxiedPage,
  PREVIEW_ERROR_MESSAGE,
  PREVIEW_READY_MESSAGE,
  PREVIEW_NAVIGATE_MESSAGE,
} from "./page-proxy"

describe("rewriteProxiedPage", () => {
  it("points relative URLs at the original site and installs the navigation hook", () => {
    const html = rewriteProxiedPage(
      '<!doctype html><html><head><title>Skill</title></head><body><a href="/other">x</a></body></html>',
      "https://skills.sh/mattpocock/skills/grill-me",
    )
    expect(html).toMatch(/<head><base href="https:\/\/skills.sh\/mattpocock\/skills\/grill-me" target="_self"><script>/)
    expect(html).toContain(PREVIEW_NAVIGATE_MESSAGE)
    expect(html.indexOf("<base")).toBeLessThan(html.indexOf("<title>"))
  })

  it("drops author base tags and in-page CSP rules that would break the proxied view", () => {
    const html = rewriteProxiedPage(
      `<html><head><base href="https://cdn.example.com/"><meta http-equiv="Content-Security-Policy" content="script-src 'self'"></head></html>`,
      "https://example.com/",
    )
    expect(html.match(/<base\b/g)).toHaveLength(1)
    expect(html).toContain('href="https://example.com/"')
    expect(html).not.toMatch(/content-security-policy/i)
  })

  it("creates a head when the page has none", () => {
    expect(rewriteProxiedPage("<html><body>hi</body></html>", "https://example.com/")).toMatch(
      /^<html><head><base href="https:\/\/example.com\/"/,
    )
    expect(rewriteProxiedPage("<p>fragment</p>", "https://example.com/")).toMatch(/^<head><base/)
  })

  it("escapes the page URL inside the base tag", () => {
    const html = rewriteProxiedPage("<head></head>", 'https://example.com/?q="><script>x</script>')
    expect(html).toContain('href="https://example.com/?q=&quot;&gt;&lt;script&gt;x&lt;/script&gt;"')
  })

  it("strips author scripts when serving a rendered browser snapshot while keeping proxy hooks", () => {
    const html = rewriteProxiedPage(
      '<html><head><script src="https://medium.com/app.js"></script></head><body><article>Story</article><script>window.crash()</script></body></html>',
      "https://medium.com/@author/story",
      { stripPageScripts: true },
    )
    expect(html).toContain("<article>Story</article>")
    expect(html).not.toContain("https://medium.com/app.js")
    expect(html).not.toContain("window.crash()")
    expect(html).toContain(PREVIEW_NAVIGATE_MESSAGE)
    expect(html).toContain(PREVIEW_READY_MESSAGE)
  })
})

describe("proxied page readiness", () => {
  const skillPage = "A relentless interview to sharpen a plan or design. Read the complete skill here."

  /** Runs the readiness script tick by tick; `text` can change per tick (0-based). */
  function probe(text: string | ((tick: number) => string), images: unknown[] = [], readyState = "complete") {
    const html = rewriteProxiedPage("<head></head><body></body>", "https://example.com/")
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    const messages: { type: string; tick: number }[] = []
    const body = { innerText: "" }
    let tick = () => {}
    let stopped = false
    let current = 0
    runInNewContext(scripts[1][1], {
      window: { parent: { postMessage: (message: { type: string }) => messages.push({ ...message, tick: current }) } },
      document: { body, images, readyState },
      setInterval: (callback: () => void) => { tick = callback; return 1 },
      clearInterval: () => { stopped = true },
    })
    for (current = 0; current < 200 && !stopped; current++) {
      body.innerText = typeof text === "function" ? text(current) : text
      tick()
    }
    return messages
  }
  const types = (messages: { type: string }[]) => messages.map((message) => message.type)

  it("reports ready for rendered content such as a skill page", () => {
    expect(types(probe(skillPage))).toEqual([PREVIEW_READY_MESSAGE])
  })

  it("waits for content to hold steady before reporting ready", () => {
    const [ready] = probe(skillPage)
    expect(ready.tick).toBeGreaterThanOrEqual(5)
    // Still loading subresources: wait, but not forever.
    expect(types(probe(skillPage, [], "interactive"))).toEqual([PREVIEW_READY_MESSAGE])
  })

  it("reports failure when a rendered page crashes while its scripts start", () => {
    const rendered = skillPage.repeat(20)
    const nextError = "Application error: a client-side exception has occurred while loading localhost (see the browser console for more information)."
    expect(types(probe((tick) => (tick < 3 ? rendered : nextError)))).toEqual([PREVIEW_ERROR_MESSAGE])
    expect(types(probe((tick) => (tick < 3 ? rendered : "")))).toEqual([PREVIEW_ERROR_MESSAGE])
  })

  it("keeps watching after ready and reports a late crash", () => {
    const rendered = skillPage.repeat(20)
    expect(types(probe((tick) => (tick < 30 ? rendered : "")))).toEqual([PREVIEW_READY_MESSAGE, PREVIEW_ERROR_MESSAGE])
  })

  it("reports failure for blank or skeleton-only pages", () => {
    expect(types(probe(""))).toEqual([PREVIEW_ERROR_MESSAGE])
    expect(types(probe("Loading…"))).toEqual([PREVIEW_ERROR_MESSAGE])
  })

  it("accepts a loaded visible image but not an unloaded image", () => {
    const image = { complete: true, naturalWidth: 600, getBoundingClientRect: () => ({ height: 300 }) }
    expect(types(probe("", [image]))).toEqual([PREVIEW_READY_MESSAGE])
    expect(types(probe("", [{ ...image, complete: false }]))).toEqual([PREVIEW_ERROR_MESSAGE])
  })
})

describe("proxied page response", () => {
  it("sandboxes the document without granting it the API origin", () => {
    const csp = proxiedPageHeaders()["Content-Security-Policy"]
    expect(csp).toMatch(/^sandbox /)
    expect(csp).not.toContain("allow-same-origin")
    expect(csp).not.toContain("allow-top-navigation")
    expect(proxiedPageHeaders()["X-Robots-Tag"]).toContain("noindex")
  })

  it("reports failures to the parent app", () => {
    const html = proxyErrorPage("Site <unreachable>")
    expect(html).toContain(`"type":"${PREVIEW_ERROR_MESSAGE}"`)
    expect(html).toContain("<p>Site &lt;unreachable&gt;</p>")
  })

  it("tells the app when the site blocked the request", () => {
    expect(proxyErrorPage("Blocked", "blocked")).toContain(`"reason":"blocked"`)
    expect(proxyErrorPage("Down")).not.toContain("reason")
  })

  it("recognizes bot-protection refusals", () => {
    const none = new Headers()
    expect(isBlockedResponse(403, none)).toBe(true)
    expect(isBlockedResponse(429, none)).toBe(true)
    expect(isBlockedResponse(503, new Headers({ server: "cloudflare" }))).toBe(true)
    expect(isBlockedResponse(503, none)).toBe(false)
    expect(isBlockedResponse(404, none)).toBe(false)
  })
})

describe("content handling", () => {
  it("recognises HTML content types", () => {
    expect(isHtmlContentType("text/html; charset=ISO-8859-1")).toBe(true)
    expect(isHtmlContentType("application/xhtml+xml")).toBe(true)
    expect(isHtmlContentType("application/pdf")).toBe(false)
    expect(isHtmlContentType(null)).toBe(false)
  })

  it("decodes using the header charset, then the meta charset, then UTF-8", () => {
    const latin = new Uint8Array([0xe9])
    expect(decodeHtml(latin, "text/html; charset=iso-8859-1")).toBe("é")
    const meta = new TextEncoder().encode('<meta charset="windows-1252"><p>')
    expect(decodeHtml(new Uint8Array([...meta, 0x80]), "text/html")).toBe('<meta charset="windows-1252"><p>€')
    expect(decodeHtml(new TextEncoder().encode("ü"), "text/html; charset=bogus")).toBe("ü")
  })
})

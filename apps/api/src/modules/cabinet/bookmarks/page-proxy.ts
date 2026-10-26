/**
 * Rewrites a third-party page so a sandboxed iframe on another origin can show it.
 *
 * Sites that send X-Frame-Options or a CSP frame-ancestors directive cannot be framed
 * directly, so the API fetches the page itself and serves it back without those headers.
 * The served page always runs with an opaque origin: the CSP sandbox below never grants
 * allow-same-origin, so page scripts cannot read API cookies or call the API as the user.
 */

export const PREVIEW_NAVIGATE_MESSAGE = "cabinet-preview-navigate"
export const PREVIEW_ERROR_MESSAGE = "cabinet-preview-error"
export const PREVIEW_READY_MESSAGE = "cabinet-preview-ready"

export const MAX_PROXIED_PAGE_BYTES = 5 * 1024 * 1024

/** Response headers for every proxied document, including error pages. */
export function proxiedPageHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    // Enforced by the browser even when the document is opened outside the iframe.
    "Content-Security-Policy":
      "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Cache-Control": "private, max-age=300",
  }
}

export function isHtmlContentType(contentType?: string | null): boolean {
  const type = contentType?.split(";")[0].trim().toLowerCase()
  return type === "text/html" || type === "application/xhtml+xml"
}

/** Decodes the page using the header charset, then a <meta> charset, then UTF-8. */
export function decodeHtml(body: Uint8Array, contentType?: string | null): string {
  const headerCharset = /charset=["']?([\w.:-]+)/i.exec(contentType ?? "")?.[1]
  const head = new TextDecoder("latin1").decode(body.subarray(0, 4096))
  const metaCharset =
    /<meta[^>]+charset=["']?([\w.:-]+)/i.exec(head)?.[1]
  for (const label of [headerCharset, metaCharset, "utf-8"]) {
    if (!label) continue
    try {
      return new TextDecoder(label).decode(body)
    } catch {
      // Unknown label; try the next candidate.
    }
  }
  return new TextDecoder().decode(body)
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

/**
 * Runs inside the proxied page. Link clicks are handed to the parent app, which reloads
 * the frame through the proxy; navigating from inside the sandboxed frame would hit the
 * original site's framing headers again and would not carry the API session cookie.
 */
const navigationScript = `(function(){\n  if (window.parent === window) return;\n  document.addEventListener("click", function (event) {\n    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;\n    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;\n    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;\n    var href = link.href;\n    if (!/^https?:/i.test(href)) return;\n    if (href.split("#")[0] === location.href.split("#")[0] && href.indexOf("#") !== -1) return;\n    event.preventDefault();\n    window.parent.postMessage({ type: ${JSON.stringify(PREVIEW_NAVIGATE_MESSAGE)}, url: href }, "*");\n  }, true);\n})();`

/**
 * Server-rendered apps often show their content and then crash while hydrating on the
 * proxy origin (e.g. Next.js "Application error"). Ready is only reported once content has
 * held steady after the page loaded, and the page keeps being watched afterwards so a late
 * crash still sends the app back to the saved details.
 */
// shortcut: visible text or a loaded large image signals content, not full app functionality.
const readinessScript = `(function () {
  if (window.parent === window) return;
  var post = function (type) { window.parent.postMessage({ type: type }, "*"); };
  var ticks = 0, peak = 0, steady = 0, ready = false;
  var timer = setInterval(function () {
    ticks++;
    var body = document.body;
    var text = body ? body.innerText.trim() : "";
    var image = Array.from(document.images).some(function (img) {
      return img.complete && img.naturalWidth >= 200 && img.getBoundingClientRect().height >= 100;
    });
    peak = Math.max(peak, text.length);
    var crashed = peak >= 40 && (text.length < peak / 4 || /client-side exception has occurred/i.test(text));
    if (crashed) {
      clearInterval(timer);
      post(${JSON.stringify(PREVIEW_ERROR_MESSAGE)});
    } else if (!ready) {
      var settled = document.readyState === "complete" || ticks >= 24;
      steady = (text.length >= 40 || image) && settled ? steady + 1 : 0;
      if (steady >= 6) {
        ready = true;
        post(${JSON.stringify(PREVIEW_READY_MESSAGE)});
      } else if (ticks >= 40) {
        clearInterval(timer);
        post(${JSON.stringify(PREVIEW_ERROR_MESSAGE)});
      }
    } else if (ticks >= 80) {
      clearInterval(timer);
    }
  }, 250);
})();`

/**
 * Prepares fetched HTML for the proxy response: drops in-page CSP rules and any
 * author <base>, then points relative URLs back at the original site and installs
 * the navigation hook. When `stripPageScripts` is set (for already-rendered browser
 * snapshots), author scripts are removed so hydration on the opaque sandbox origin
 * cannot crash the rendered document.
 */
export function rewriteProxiedPage(
  html: string,
  pageUrl: string,
  options?: { stripPageScripts?: boolean },
): string {
  let stripped = html
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
  if (options?.stripPageScripts) {
    stripped = stripped.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  }
  const injection =
    `<base href="${escapeHtml(pageUrl)}" target="_self">` +
    `<script>${navigationScript}</script><script>${readinessScript}</script>`
  const headMatch = /<head\b[^>]*>/i.exec(stripped)
  if (headMatch) {
    const at = headMatch.index + headMatch[0].length
    return stripped.slice(0, at) + injection + stripped.slice(at)
  }
  const htmlMatch = /<html\b[^>]*>/i.exec(stripped)
  if (htmlMatch) {
    const at = htmlMatch.index + htmlMatch[0].length
    return stripped.slice(0, at) + `<head>${injection}</head>` + stripped.slice(at)
  }
  return `<head>${injection}</head>` + stripped
}

/**
 * Fetches a rendered HTML snapshot with a real Chromium TLS/HTTP2 stack when plain
 * Node `fetch` is refused by bot protection (such as Medium behind Cloudflare).
 */
export async function fetchWithBrowserFallback(
  url: string,
  validateUrl: (candidate: string) => Promise<unknown>,
): Promise<{ html: string; finalUrl: string } | null> {
  let browser: import("playwright-core").Browser | undefined
  try {
    await validateUrl(url)
    const { chromium } = await import("playwright-core")
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    })
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
    })
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined })
    })
    const page = await context.newPage()
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12000 })
    const finalUrl = page.url()
    await validateUrl(finalUrl)
    if (!response || response.status() >= 400) return null
    const title = await page.title()
    if (/^(just a moment|attention required)/i.test(title.trim())) return null
    const html = await page.content()
    if (!html || Buffer.byteLength(html, "utf8") > MAX_PROXIED_PAGE_BYTES) return null
    return { html, finalUrl }
  } catch {
    return null
  } finally {
    await browser?.close().catch(() => undefined)
  }
}

/** Why a preview failed, so the app can say more than "could not be loaded". */
export type PreviewErrorReason = "blocked"

/**
 * Bot protection (Cloudflare and the like) answers server requests with a refusal or a
 * challenge page, whatever the user agent. Medium is one such site.
 */
export function isBlockedResponse(status: number, headers: Headers): boolean {
  if (status === 401 || status === 403 || status === 429) return true
  if (status !== 503) return false
  return headers.has("cf-mitigated") || /cloudflare/i.test(headers.get("server") ?? "")
}

/** A page that tells the parent app the proxy could not render the site. */
export function proxyErrorPage(message: string, reason?: PreviewErrorReason): string {
  const payload = JSON.stringify({ type: PREVIEW_ERROR_MESSAGE, message, reason }).replace(/</g, "\\u003c")
  return `<!doctype html><html><head><meta charset="utf-8"><title>Preview unavailable</title>` +
    `<script>if(window.parent!==window)window.parent.postMessage(${payload},"*");</script>` +
    `</head><body style="font:14px system-ui,sans-serif;color:#555;padding:24px">` +
    `<p>${escapeHtml(message)}</p></body></html>`
}

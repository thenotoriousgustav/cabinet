import { Injectable, Logger } from "@nestjs/common"
import {
  ExtractedMetadata,
  MetadataProvider,
  CRAWLER_USER_AGENTS,
  DetectedContentType,
  contentTypeFromMime,
  decodeHtmlEntities,
} from "./metadata-provider.interface"
import { validatePublicUrl } from "@/common/utils/ssrf"
import { readMetadataHtml } from "./metadata-body"

@Injectable()
export class GenericMetadataProvider implements MetadataProvider {
  private readonly logger = new Logger(GenericMetadataProvider.name)

  private readonly userAgents = [
    CRAWLER_USER_AGENTS.FACEBOOK_EXTERNAL_HIT,
    CRAWLER_USER_AGENTS.WHATSAPP,
    CRAWLER_USER_AGENTS.CHROME_DESKTOP,
  ]

  supports(): boolean {
    return true
  }

  async extract(url: string): Promise<ExtractedMetadata | null> {
    try {
      await validatePublicUrl(url)
      const fetched = await this.fetchHtml(url)
      if (!fetched) return { title: this.getDomain(url), unavailable: true }
      if ("file" in fetched) return this.describeFile(url, fetched.file)
      const html = fetched.html

      const rawTitle =
        this.getMetaContent(html, "property", "og:title") ||
        this.getMetaContent(html, "name", "og:title") ||
        html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ||
        this.getDomain(url)

      const rawDescription =
        this.getMetaContent(html, "property", "og:description") ||
        this.getMetaContent(html, "name", "og:description") ||
        this.getMetaContent(html, "name", "description")

      const rawImage =
        this.getMetaContent(html, "property", "og:image") ||
        this.getMetaContent(html, "property", "og:image:url") ||
        this.getMetaContent(html, "property", "og:image:secure_url") ||
        this.getMetaContent(html, "name", "og:image") ||
        this.getMetaContent(html, "itemprop", "image") ||
        html.match(
          /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i
        )?.[1] ||
        html.match(
          /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["']/i
        )?.[1]
      const rawSiteName =
        this.getMetaContent(html, "property", "og:site_name") ||
        this.getMetaContent(html, "name", "og:site_name") ||
        this.getMetaContent(html, "name", "application-name") ||
        this.getMetaContent(html, "name", "apple-mobile-web-app-title")
      const rawFavicon =
        html.match(
          /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i
        )?.[1] ||
        html.match(
          /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i
        )?.[1] ||
        html.match(
          /<link[^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]+href=["']([^"']+)["']/i
        )?.[1] ||
        html.match(
          /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon(?:-precomposed)?["']/i
        )?.[1]

      return {
        contentType: this.detectContentType(html, url),
        title: decodeHtmlEntities(rawTitle.trim() || this.getDomain(url)).slice(0, 1000),
        description: rawDescription
          ? decodeHtmlEntities(rawDescription.trim()).slice(0, 1000)
          : undefined,
        imageUrl: this.resolveUrl(rawImage, url),
        faviconUrl: this.resolveUrl(rawFavicon, url),
        siteName: rawSiteName
          ? decodeHtmlEntities(rawSiteName.trim()).slice(0, 200)
          : undefined,
      }
    } catch (error) {
      this.logger.warn(
        `Failed to extract generic metadata for ${url}: ${(error as Error).message}`
      )
      return { title: this.getDomain(url), unavailable: true }
    }
  }

  /**
   * What the page says it is. Only clear signs count: a site that merely hosts video, like a
   * Pinterest photo pin, says nothing here and stays unclassified.
   */
  private detectContentType(html: string, url: string): DetectedContentType | undefined {
    const ogType = this.getMetaContent(html, "property", "og:type")?.toLowerCase()
    if (
      ogType?.startsWith("video") ||
      this.getMetaContent(html, "property", "og:video") ||
      this.getMetaContent(html, "property", "og:video:url") ||
      this.getMetaContent(html, "property", "og:video:secure_url")
    ) {
      return "VIDEO"
    }
    if (ogType === "article") return "ARTICLE"
    return this.detectPin(html, url, ogType)
  }

  /**
   * Pinterest sends no og:video. A video pin carries its streams in the page's embedded data
   * ("videos":{...,"video_list":...}); a photo pin has "videos":null. Checked on real pins.
   */
  private detectPin(html: string, url: string, ogType: string | undefined): DetectedContentType | undefined {
    if (ogType !== "pinterestapp:pin" || !/^\/(?:[^/]+\/)?pin\//.test(this.pathOf(url))) {
      return undefined
    }
    return /"videos":\{[^}]{0,200}"video_list"/.test(html) ? "VIDEO" : undefined
  }

  private pathOf(url: string): string {
    try {
      return new URL(url).pathname
    } catch {
      return ""
    }
  }

  /** A link straight to a video file has no page to read; describe it by its file name. */
  private describeFile(url: string, file: DetectedContentType): ExtractedMetadata {
    let name = this.getDomain(url)
    try {
      const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "")
      if (last) name = last
    } catch {
      // Keep the domain.
    }
    return {
      title: name,
      contentType: file,
      siteName: this.getDomain(url),
    }
  }

  private async fetchHtml(
    url: string
  ): Promise<{ html: string } | { file: DetectedContentType } | null> {
    for (const userAgent of this.userAgents) {
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": userAgent,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
          },
          signal: AbortSignal.timeout(6000),
          redirect: "follow",
        })
        if (!response.ok) { await response.body?.cancel().catch(() => undefined); continue }

        const file = contentTypeFromMime(response.headers.get("content-type"))
        if (file) {
          // Not a page: skip the body rather than download the whole file.
          await response.body?.cancel().catch(() => undefined)
          return { file }
        }

        const html = await readMetadataHtml(response)
        if (
          html &&
          (/<(?:meta|title)\b/i.test(html) ||
            userAgent === this.userAgents[this.userAgents.length - 1])
        ) {
          return { html }
        }
      } catch {
        // Retry the same URL with the next user agent.
      }
    }
    return null
  }

  private getMetaContent(
    html: string,
    attr: "name" | "property" | "itemprop",
    value: string
  ): string | undefined {
    const pattern1 = new RegExp(
      `<meta\\s+[^>]*${attr}=["']${value}["'][^>]*content=["']([^"']+)["']`,
      "i"
    )
    const pattern2 = new RegExp(
      `<meta\\s+[^>]*content=["']([^"']+)["'][^>]*${attr}=["']${value}["']`,
      "i"
    )
    return html.match(pattern1)?.[1] || html.match(pattern2)?.[1]
  }

  private resolveUrl(
    value: string | undefined,
    baseUrl: string
  ): string | undefined {
    if (!value) return undefined
    try {
      const url = new URL(decodeHtmlEntities(value.trim()), baseUrl)
      return ["http:", "https:"].includes(url.protocol) && url.href.length <= 2048 ? url.href : undefined
    } catch {
      return undefined
    }
  }

  private getDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "")
    } catch {
      return url
    }
  }
}

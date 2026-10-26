import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common"
import { PrismaService } from "@/prisma/prisma.service"
import { bookmarkSortFields } from "../bookmarks/bookmark-order"
import { validatePublicUrl } from "@/common/utils/ssrf"
import { BackgroundTasksService } from "./background-tasks.service"

@Injectable()
export class LinkCheckerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LinkCheckerService.name)
  private startup?: ReturnType<typeof setTimeout>
  private daily?: ReturnType<typeof setInterval>
  constructor(private prisma: PrismaService, private tasks: BackgroundTasksService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test") return
    const schedule = () => void this.scheduleDueScans().catch(() => this.logger.warn("Could not schedule daily link checks"))
    this.startup = setTimeout(schedule, 60000); this.startup.unref()
    this.daily = setInterval(schedule, 24 * 60 * 60 * 1000); this.daily.unref()
  }
  onModuleDestroy() { clearTimeout(this.startup); clearInterval(this.daily) }
  private due() { return { OR: [{ lastChecked: null }, { lastChecked: { lt: new Date(Date.now() - 86400000) } }] } }
  async scheduleDueScans() {
    const users = await this.prisma.bookmark.groupBy({ by: ["userId"], where: { type: "BOOKMARK", url: { not: null }, deletedAt: null, ...this.due() } })
    for (const user of users) await this.tasks.create(user.userId, "LINK_CHECK", { dueOnly: true })
  }
  async runScan(userId: string, progress: (processed: number, total: number, failed: number) => Promise<void> = async () => {}, dueOnly = false) {
    const where = { userId, type: "BOOKMARK" as const, url: { not: null }, deletedAt: null, createdAt: { lte: new Date() }, ...(dueOnly ? this.due() : {}) }
    const total = await this.prisma.bookmark.count({ where })
    let processed = 0, failed = 0, cursor: string | undefined
    await progress(0, total, 0)
    while (true) {
      const rows = await this.prisma.bookmark.findMany({ where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) }, select: { id: true, url: true }, orderBy: { id: "asc" }, take: 100 })
      if (!rows.length) break
      let next = 0
      await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
        while (next < rows.length) {
          const row = rows[next++]
          const status = await this.checkBookmark({ id: row.id, url: row.url! })
          if (status === "UNKNOWN") failed++
          processed++
          if (processed % 10 === 0) await progress(processed, total, failed)
        }
      }))
      cursor = rows.at(-1)!.id
    }
    await progress(processed, processed, failed)
  }
  async checkBookmark(bookmark: { id: string; url: string }) {
    const where = { id: bookmark.id, url: bookmark.url, deletedAt: null }
    let data: { status: string; statusCode: number | null; lastChecked: Date; url?: string; sortDomain?: string | null }
    try {
      await validatePublicUrl(bookmark.url)
      const response = await fetch(bookmark.url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5000), headers: { "User-Agent": "Mozilla/5.0 (compatible; CabinetBot/1.0)" } })
      const location = response.headers.get("location")
      if ([301, 308].includes(response.status) && location) {
        const target = await validatePublicUrl(new URL(location, bookmark.url).href)
        data = { url: target.href, ...bookmarkSortFields({ url: target.href }), status: "REDIRECTED", statusCode: response.status, lastChecked: new Date() }
      } else {
        const inconclusive = [401, 403, 405, 408, 429, 500, 502, 503, 504].includes(response.status)
        data = { status: inconclusive ? "UNKNOWN" : response.status < 400 ? "OK" : "BROKEN", statusCode: response.status, lastChecked: new Date() }
      }
    } catch {
      // Network failures and blocked/private targets do not prove that a public page is dead.
      data = { status: "UNKNOWN", statusCode: null, lastChecked: new Date() }
    }
    await this.prisma.bookmark.updateMany({ where, data })
    return data.status
  }
}

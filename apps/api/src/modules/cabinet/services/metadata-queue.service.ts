import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common"
import { InjectQueue } from "@nestjs/bullmq"
import { Queue } from "bullmq"
import { PrismaService } from "@/prisma/prisma.service"

@Injectable()
export class MetadataQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetadataQueueService.name)
  private timer?: ReturnType<typeof setInterval>
  private recovering = false
  constructor(private prisma: PrismaService, @InjectQueue("bookmark-enrichment") private queue: Queue) {}

  async enqueue(bookmark: { id: string; url: string | null }, retry = false) {
    if (!bookmark.url) return false
    try {
      const existing = await this.queue.getJob(`metadata-${bookmark.id}`)
      if (existing) {
        const state = await existing.getState()
        if (["active", "waiting", "delayed", "prioritized", "waiting-children"].includes(state)) return false
        await existing.remove()
      }
      if (retry) await this.prisma.bookmark.updateMany({
        where: { id: bookmark.id, type: "BOOKMARK", deletedAt: null },
        data: { metadataStatus: "PENDING", metadataError: null },
      })
      await this.queue.add("enrich", { bookmarkId: bookmark.id, url: bookmark.url }, {
        jobId: `metadata-${bookmark.id}`, removeOnComplete: true, removeOnFail: true,
      })
      return true
    } catch {
      // The database is the recovery source if Redis is temporarily unavailable.
      await this.prisma.bookmark.updateMany({
        where: { id: bookmark.id, deletedAt: null, metadataStatus: { in: ["PENDING", "FAILED"] } },
        data: { metadataStatus: "PENDING", metadataError: "Waiting for the background service to reconnect" },
      })
      this.logger.warn("Could not enqueue metadata; pending work will be retried")
      return false
    }
  }

  async recoverPending() {
    if (this.recovering) return
    this.recovering = true
    try {
      const rows = await this.prisma.bookmark.findMany({
        where: { type: "BOOKMARK", url: { not: null }, deletedAt: null, metadataStatus: { in: ["PENDING", "PROCESSING"] } },
        select: { id: true, url: true }, orderBy: { updatedAt: "asc" }, take: 100,
      })
      for (const row of rows) await this.enqueue(row)
    } finally { this.recovering = false }
  }
  onModuleInit() {
    if (process.env.NODE_ENV === "test") return
    this.timer = setInterval(() => void this.recoverPending().catch(() => this.logger.warn("Metadata recovery is temporarily unavailable")), 60000)
    this.timer.unref()
  }
  onModuleDestroy() { clearInterval(this.timer) }
}

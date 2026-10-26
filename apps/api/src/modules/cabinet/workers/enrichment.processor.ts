import { Processor, WorkerHost } from "@nestjs/bullmq"
import { Logger } from "@nestjs/common"
import { Job } from "bullmq"
import { Prisma, BookmarkContentType } from "@prisma/client"
import { bookmarkSortFields } from "../bookmarks/bookmark-order"
import { PrismaService } from "@/prisma/prisma.service"
import { MetadataService } from "../services/metadata.service"

export interface EnrichmentJobData { bookmarkId: string; url: string }

@Processor("bookmark-enrichment", { concurrency: 3 })
export class EnrichmentProcessor extends WorkerHost {
  private readonly logger = new Logger(EnrichmentProcessor.name)
  constructor(private readonly prisma: PrismaService, private readonly metadataService: MetadataService) { super() }

  async process(job: Job<EnrichmentJobData>): Promise<void> {
    const bookmark = await this.prisma.bookmark.findUnique({
      where: { id: job.data.bookmarkId },
      select: { id: true, type: true, url: true, title: true, contentType: true, deletedAt: true, metadataStatus: true, metadataTitlePending: true },
    })
    if (!bookmark || bookmark.deletedAt || bookmark.type !== "BOOKMARK" || !bookmark.url || ["COMPLETED", "FAILED"].includes(bookmark.metadataStatus)) return
    const where = { id: bookmark.id, url: bookmark.url, type: "BOOKMARK" as const, deletedAt: null }
    const claimed = await this.prisma.bookmark.updateMany({ where: { ...where, metadataStatus: { in: ["PENDING", "PROCESSING"] } }, data: { metadataStatus: "PROCESSING", metadataError: null } })
    if (!claimed.count) return
    try {
      const extracted = await this.metadataService.extract(bookmark.url)
      if (extracted.unavailable) {
        await this.prisma.bookmark.updateMany({ where, data: {
          metadataStatus: "FAILED", metadataError: "The website blocked or did not answer the metadata request. Your bookmark is saved; you can retry later.", lastEnrichedAt: new Date(),
        } })
        return
      }
      const writes: Prisma.PrismaPromise<Prisma.BatchPayload>[] = []
      if (extracted.title && bookmark.metadataTitlePending) writes.push(this.prisma.bookmark.updateMany({
        where: { ...where, title: bookmark.title, metadataTitlePending: true }, data: { title: extracted.title, metadataTitlePending: false, ...bookmarkSortFields({ title: extracted.title }) },
      }))
      // Fill only missing fields. A worker must never overwrite a user's edits made while fetching.
      for (const field of ["description", "imageUrl", "faviconUrl", "siteName"] as const) {
        if (extracted[field]) writes.push(this.prisma.bookmark.updateMany({
          where: { ...where, OR: [{ [field]: null }, { [field]: "" }] }, data: { [field]: extracted[field] },
        }))
      }
      if (extracted.contentType && Object.values(BookmarkContentType).includes(extracted.contentType as BookmarkContentType)) writes.push(this.prisma.bookmark.updateMany({
        where: { ...where, OR: [{ contentType: null }, { contentType: "UNKNOWN" }] }, data: { contentType: extracted.contentType as BookmarkContentType },
      }))
      writes.push(this.prisma.bookmark.updateMany({ where, data: { metadataStatus: "COMPLETED", metadataError: null, lastEnrichedAt: new Date() } }))
      await this.prisma.$transaction(writes)
    } catch (error) {
      const retrying = job.attemptsMade + 1 < (job.opts?.attempts ?? 1)
      await this.prisma.bookmark.updateMany({ where, data: { metadataStatus: retrying ? "PENDING" : "FAILED", metadataError: retrying ? "Waiting to retry metadata" : "Could not update metadata. Your bookmark is saved; retry from Activity." } })
      this.logger.warn(`Metadata job ${job.id} failed; ${retrying ? "retry scheduled" : "needs attention"}`)
      throw error
    }
  }
}

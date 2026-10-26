import { Processor, WorkerHost } from "@nestjs/bullmq"
import { Job } from "bullmq"
import { Prisma } from "@prisma/client"
import { PrismaService } from "@/prisma/prisma.service"
import { BookmarksService } from "../bookmarks/bookmarks.service"
import { LinkCheckerService } from "../services/link-checker.service"

@Processor("cabinet-tasks", { concurrency: 2 })
export class BackgroundTaskProcessor extends WorkerHost {
  constructor(private prisma: PrismaService, private bookmarks: BookmarksService, private links: LinkCheckerService) { super() }
  async process(job: Job<{ taskId: string }>) {
    const original = await this.prisma.backgroundTask.findUnique({ where: { id: job.data.taskId } })
    if (!original || ["COMPLETED", "FAILED"].includes(original.status)) return
    const task = await this.prisma.backgroundTask.update({ where: { id: original.id, status: { in: ["PENDING", "RUNNING"] } }, data: { status: "RUNNING", processed: 0, total: 0, failed: 0, error: null, startedAt: new Date(), finishedAt: null, attempt: { increment: 1 } } }).catch((error) => {
      if ((error as { code?: string }).code === "P2025") return null
      throw error
    })
    if (!task) return
    const where = { id: task.id, attempt: task.attempt, status: "RUNNING" }
    const progress = async (processed: number, total: number, failed: number) => {
      await this.prisma.backgroundTask.updateMany({ where: { ...where, processed: { lte: processed } }, data: { processed, total, failed } })
    }
    try {
      const payload = task.payload as { html?: string; dueOnly?: boolean } | null
      if (task.kind === "IMPORT" && payload?.html) await this.bookmarks.performImport(task.id, task.userId, payload.html, progress)
      else if (task.kind === "LINK_CHECK") await this.links.runScan(task.userId, progress, payload?.dueOnly)
      else throw new Error("Unsupported task")
      await this.prisma.backgroundTask.updateMany({ where, data: { status: "COMPLETED", activeKey: null, payload: Prisma.DbNull, finishedAt: new Date() } })
    } catch (error) {
      const retrying = job.attemptsMade + 1 < (job.opts?.attempts ?? 1)
      await this.prisma.backgroundTask.updateMany({ where, data: {
        status: retrying ? "PENDING" : "FAILED", activeKey: retrying ? task.activeKey : null,
        error: task.kind === "IMPORT" ? "Import interrupted. Already saved items are kept; retry safely from Activity." : "Link check interrupted. Retry safely from Activity.",
        finishedAt: retrying ? null : new Date(),
      } })
      throw error
    }
  }
}

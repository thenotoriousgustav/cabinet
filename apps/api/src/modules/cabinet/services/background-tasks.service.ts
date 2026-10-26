import { Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit, OnModuleDestroy } from "@nestjs/common"
import { InjectQueue } from "@nestjs/bullmq"
import { Prisma } from "@prisma/client"
import { Queue } from "bullmq"
import { createHash } from "node:crypto"
import { PrismaService } from "@/prisma/prisma.service"

export const taskSelect = { id: true, kind: true, status: true, total: true, processed: true, failed: true, attempt: true, error: true, createdAt: true, updatedAt: true, startedAt: true, finishedAt: true } as const
export type TaskKind = "IMPORT" | "LINK_CHECK"

@Injectable()
export class BackgroundTasksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackgroundTasksService.name)
  private timer?: ReturnType<typeof setInterval>
  private recovering = false
  constructor(private prisma: PrismaService, @InjectQueue("cabinet-tasks") private queue: Queue) {}

  async create(userId: string, kind: TaskKind, payload?: Prisma.InputJsonValue) {
    // An account cannot accidentally start the same long-running operation twice.
    const activeKey = `${kind}:${userId}`
    let task
    try { task = await this.prisma.backgroundTask.create({ data: { userId, kind, payload, activeKey }, select: taskSelect }) }
    catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error
      const previous = await this.prisma.backgroundTask.findUnique({ where: { activeKey } })
      if (!previous) throw error
      if (kind === "IMPORT" && JSON.stringify(previous.payload) !== JSON.stringify(payload)) throw new BadRequestException("Another import is already running. Wait for it to finish before importing another file.")
      return this.publicTask(previous.id, userId)
    }
    await this.enqueue(task.id)
    return task
  }
  private async publicTask(id: string, userId: string) {
    return this.prisma.backgroundTask.findFirst({ where: { id, userId }, select: taskSelect })
  }
  async enqueue(id: string) {
    try {
      const existing = await this.queue.getJob(`task-${id}`)
      if (existing) {
        const state = await existing.getState()
        if (["active", "waiting", "delayed", "prioritized", "waiting-children"].includes(state)) return
        await existing.remove()
      }
      await this.queue.add("run", { taskId: id }, { jobId: `task-${id}`, removeOnComplete: true, removeOnFail: true })
    } catch {
      await this.prisma.backgroundTask.updateMany({ where: { id, status: "PENDING" }, data: { error: "Waiting for the background service to reconnect" } })
      this.logger.warn("Task remains pending while the background service is unavailable")
    }
  }
  async retry(userId: string, id: string) {
    const task = await this.publicTask(id, userId)
    if (!task) throw new NotFoundException("Task not found")
    if (task.status !== "FAILED") throw new BadRequestException("Only failed tasks can be retried")
    const updated = await this.prisma.backgroundTask.updateMany({ where: { id, userId, status: "FAILED" }, data: { status: "PENDING", activeKey: `${task.kind}:${userId}`, error: null, finishedAt: null } }).catch((error) => {
      if ((error as { code?: string }).code === "P2002") throw new BadRequestException("Another task of this type is already running")
      throw error
    })
    if (updated.count) await this.enqueue(id)
    return this.publicTask(id, userId)
  }
  async overview(userId: string) {
    const [tasks, metadata, savedLinks, organizedItems, user] = await Promise.all([
      this.prisma.backgroundTask.groupBy({ by: ["status"], where: { userId }, _count: { _all: true } }),
      this.prisma.bookmark.groupBy({ by: ["metadataStatus"], where: { userId, type: "BOOKMARK", url: { not: null }, deletedAt: null }, _count: { _all: true } }),
      this.prisma.bookmark.count({ where: { userId, type: "BOOKMARK", deletedAt: null } }),
      this.prisma.bookmark.count({ where: { userId, deletedAt: null, OR: [{ folderId: { not: null } }, { tags: { some: { userId } } }] } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { onboardingDismissed: true, extensionLastSeenAt: true } }),
    ])
    const taskCounts = Object.fromEntries(tasks.map((row) => [row.status, row._count._all]))
    const metadataCounts = Object.fromEntries(metadata.map((row) => [row.metadataStatus, row._count._all]))
    return {
      pending: (taskCounts.PENDING || 0) + (metadataCounts.PENDING || 0),
      running: (taskCounts.RUNNING || 0) + (metadataCounts.PROCESSING || 0),
      failed: (taskCounts.FAILED || 0) + (metadataCounts.FAILED || 0),
      completed: (taskCounts.COMPLETED || 0) + (metadataCounts.COMPLETED || 0),
      onboarding: { dismissed: user?.onboardingDismissed ?? false, savedLink: savedLinks > 0, organized: organizedItems > 0, extensionSaved: !!user?.extensionLastSeenAt },
    }
  }
  async list(userId: string, page = 1) {
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw new BadRequestException("Page must be between 1 and 10000")
    const skip = (page - 1) * 30
    const select = { id: true, title: true, url: true, metadataStatus: true, metadataError: true, lastEnrichedAt: true, updatedAt: true } as const
    const [summary, tasks, unfinished, recent] = await Promise.all([
      this.overview(userId),
      this.prisma.backgroundTask.findMany({ where: { userId }, select: taskSelect, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip, take: 31 }),
      this.prisma.bookmark.findMany({
        where: { userId, deletedAt: null, type: "BOOKMARK", url: { not: null }, metadataStatus: { not: "COMPLETED" } },
        select, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip, take: 31,
      }),
      page === 1 ? this.prisma.bookmark.findMany({
        where: { userId, deletedAt: null, type: "BOOKMARK", url: { not: null }, metadataStatus: "COMPLETED" },
        select, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 10,
      }) : Promise.resolve([]),
    ])
    return { summary, tasks: tasks.slice(0, 30), metadata: [...unfinished.slice(0, 30), ...recent], page, hasMore: tasks.length > 30 || unfinished.length > 30 }
  }
  async dismissOnboarding(userId: string, dismissed: boolean) {
    await this.prisma.user.update({ where: { id: userId }, data: { onboardingDismissed: dismissed } })
    return { dismissed }
  }
  async recoverPending() {
    if (this.recovering) return
    this.recovering = true
    try {
      const tasks = await this.prisma.backgroundTask.findMany({ where: { status: { in: ["PENDING", "RUNNING"] } }, select: { id: true }, orderBy: { updatedAt: "asc" }, take: 100 })
      for (const task of tasks) await this.enqueue(task.id)
    } finally { this.recovering = false }
  }
  onModuleInit() {
    if (process.env.NODE_ENV === "test") return
    this.timer = setInterval(() => void this.recoverPending().catch(() => this.logger.warn("Task recovery is temporarily unavailable")), 30000)
    this.timer.unref()
  }
  onModuleDestroy() { clearInterval(this.timer) }
}

export function stableTaskId(input: string) {
  const hash = createHash("sha256").update(input).digest("hex")
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

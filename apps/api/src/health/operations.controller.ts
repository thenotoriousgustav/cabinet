import { Controller, Get, Header, UseGuards, ForbiddenException, Res } from "@nestjs/common"
import { ApiTags, ApiCookieAuth } from "@nestjs/swagger"
import type { Response } from "express"
import { AuthGuard } from "@/auth/guards/auth.guard"
import { CurrentUser } from "@/common/decorators/current-user.decorator"
import { PrismaService } from "@/prisma/prisma.service"
import { RuntimeMetricsService } from "./runtime-metrics.service"

export function canViewMetrics(userId: string) {
  return (process.env.OPERATIONS_USER_IDS || "").split(",").map((id) => id.trim()).filter(Boolean).includes(userId)
}

@ApiTags("operations")
@ApiCookieAuth()
@Controller("v1/operations")
@UseGuards(AuthGuard)
export class OperationsController {
  constructor(private metrics: RuntimeMetricsService, private prisma: PrismaService) {}
  @Get("access")
  @Header("Cache-Control", "private, no-store")
  access(@CurrentUser() user: { id: string }) { return { enabled: canViewMetrics(user.id) } }
  @Get("metrics")
  async snapshot(@CurrentUser() user: { id: string }, @Res({ passthrough: true }) response: Response) {
    if (!canViewMetrics(user.id)) throw new ForbiddenException("Metrics are restricted to configured operators")
    response.setHeader("Cache-Control", "private, no-store")
    const [tasks, metadata] = await Promise.all([
      this.prisma.backgroundTask.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.bookmark.groupBy({ by: ["metadataStatus"], where: { type: "BOOKMARK", deletedAt: null }, _count: { _all: true } }),
    ])
    return { ...this.metrics.snapshot(), jobs: { tasks: Object.fromEntries(tasks.map((row) => [row.status, row._count._all])), metadata: Object.fromEntries(metadata.map((row) => [row.metadataStatus, row._count._all])) } }
  }
}

jest.mock("@/auth/guards/auth.guard", () => ({ AuthGuard: class {} }))

import { DurationWindow, RuntimeMetricsService, safeQueryShape } from "./runtime-metrics.service"
import { OperationsController, canViewMetrics } from "./operations.controller"

describe("bounded private runtime measurements", () => {
  it("keeps only 512 samples while preserving request/error counters", () => {
    const window = new DurationWindow()
    for (let i = 1; i <= 600; i++) window.observe(i, i === 600)
    expect(window.snapshot()).toMatchObject({ count: 600, errors: 1, samples: 512, maxMs: 600 })
    expect(window.snapshot().p95Ms).toBeGreaterThan(550)
    window.observe(NaN)
    expect(window.snapshot().count).toBe(600)
  })
  it("never retains SQL literals, query parameters, or user data", () => {
    const metrics = new RuntimeMetricsService()
    metrics.query(`SELECT 'private note' FROM "public"."bookmarks" WHERE "userId" = 'secret-owner'`, 120)
    expect(safeQueryShape(`UPDATE users SET email = 'private@example.test'`)).toBe("UPDATE users")
    const result = metrics.snapshot()
    expect(JSON.stringify(result)).not.toMatch(/private note|secret-owner|SELECT '|private@example/)
    expect(result.queries[0]).toMatchObject({ name: "SELECT bookmarks", count: 1, p95Ms: 120 })
    expect(result.cpuPercent).toBeNull()
  })
  it("denies operators by default and never queries data for an unauthorized account", async () => {
    const before = process.env.OPERATIONS_USER_IDS
    try {
      delete process.env.OPERATIONS_USER_IDS
      expect(canViewMetrics("member")).toBe(false)
      process.env.OPERATIONS_USER_IDS = "owner, another-operator"
      expect(canViewMetrics("owner")).toBe(true)
      const prisma = { backgroundTask: { groupBy: jest.fn() } }
      const controller = new OperationsController(new RuntimeMetricsService(), prisma as any)
      await expect(controller.snapshot({ id: "member" }, {} as any)).rejects.toThrow("restricted")
      expect(prisma.backgroundTask.groupBy).not.toHaveBeenCalled()
    } finally {
      if (before === undefined) delete process.env.OPERATIONS_USER_IDS
      else process.env.OPERATIONS_USER_IDS = before
    }
  })
})

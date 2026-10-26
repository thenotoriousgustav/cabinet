import { BackgroundTaskProcessor } from "./background-task.processor"

describe("task worker state guards", () => {
  const job = { id: "j1", data: { taskId: "t1" }, attemptsMade: 0, opts: { attempts: 3 } } as any
  it.each(["COMPLETED", "FAILED"])("does not revive a terminal %s task", async (status) => {
    const prisma = { backgroundTask: { findUnique: jest.fn().mockResolvedValue({ id: "t1", status }), update: jest.fn() } }
    await new BackgroundTaskProcessor(prisma as any, {} as any, {} as any).process(job)
    expect(prisma.backgroundTask.update).not.toHaveBeenCalled()
  })
  it("does not restart a task that completed or was deleted between lookup and claim", async () => {
    const prisma = { backgroundTask: { findUnique: jest.fn().mockResolvedValue({ id: "t1", status: "PENDING" }), update: jest.fn().mockRejectedValue({ code: "P2025" }) } }
    const imports = { performImport: jest.fn() }
    await new BackgroundTaskProcessor(prisma as any, imports as any, {} as any).process(job)
    expect(prisma.backgroundTask.update.mock.calls[0][0].where).toEqual({ id: "t1", status: { in: ["PENDING", "RUNNING"] } })
    expect(imports.performImport).not.toHaveBeenCalled()
  })
  it("fences progress and completion by attempt and removes successful import payloads", async () => {
    const task = { id: "t1", userId: "owner", kind: "IMPORT", status: "RUNNING", attempt: 2, payload: { html: "private export" } }
    const prisma = { backgroundTask: { findUnique: jest.fn().mockResolvedValue({ ...task, status: "PENDING" }), update: jest.fn().mockResolvedValue(task), updateMany: jest.fn() } }
    const imports = { performImport: jest.fn(async (_id, _user, _html, progress) => progress(25, 30, 1)) }
    await new BackgroundTaskProcessor(prisma as any, imports as any, {} as any).process(job)
    expect(prisma.backgroundTask.updateMany).toHaveBeenCalledWith({ where: { id: "t1", attempt: 2, status: "RUNNING", processed: { lte: 25 } }, data: { processed: 25, total: 30, failed: 1 } })
    expect(prisma.backgroundTask.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "t1", attempt: 2, status: "RUNNING" }, data: expect.objectContaining({ status: "COMPLETED", activeKey: null, payload: expect.anything() }) }))
  })
})

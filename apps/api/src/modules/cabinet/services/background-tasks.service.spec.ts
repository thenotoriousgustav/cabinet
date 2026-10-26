import { BackgroundTasksService, taskSelect } from "./background-tasks.service"

describe("account-scoped background tasks", () => {
  function fixture() {
    const task = { id: "task1", userId: "owner", kind: "IMPORT", status: "PENDING" }
    const prisma = { backgroundTask: { create: jest.fn().mockResolvedValue(task), findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(task), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([]) } }
    const queue = { getJob: jest.fn().mockResolvedValue(null), add: jest.fn() }
    return { task, prisma, queue, service: new BackgroundTasksService(prisma as any, queue as any) }
  }
  it("stores import content in the database but queues only a task ID", async () => {
    const f = fixture()
    await f.service.create("owner", "IMPORT", { html: "private bookmark export" })
    expect(f.prisma.backgroundTask.create).toHaveBeenCalledWith({ data: { userId: "owner", kind: "IMPORT", payload: { html: "private bookmark export" }, activeKey: "IMPORT:owner" }, select: taskSelect })
    expect(f.queue.add.mock.calls[0][1]).toEqual({ taskId: "task1" })
    expect(taskSelect).not.toHaveProperty("payload")
    expect(taskSelect).not.toHaveProperty("userId")
  })
  it("does not silently discard a different file when an import is already active", async () => {
    const f = fixture()
    f.prisma.backgroundTask.create.mockRejectedValue({ code: "P2002" })
    f.prisma.backgroundTask.findUnique.mockResolvedValue({ ...f.task, payload: { html: "first" } })
    await expect(f.service.create("owner", "IMPORT", { html: "second" })).rejects.toThrow("Another import")
    expect(f.queue.add).not.toHaveBeenCalled()
  })
  it("cannot retry someone else's task or restart successful work", async () => {
    const f = fixture()
    f.prisma.backgroundTask.findFirst.mockResolvedValueOnce(null)
    await expect(f.service.retry("outsider", "task1")).rejects.toThrow("Task not found")
    expect(f.prisma.backgroundTask.findFirst).toHaveBeenCalledWith({ where: { id: "task1", userId: "outsider" }, select: taskSelect })
    f.prisma.backgroundTask.findFirst.mockResolvedValue({ ...f.task, status: "COMPLETED" })
    await expect(f.service.retry("owner", "task1")).rejects.toThrow("Only failed")
    expect(f.prisma.backgroundTask.updateMany).not.toHaveBeenCalled()
  })
  it("leaves queue failures pending for recovery instead of reporting completion", async () => {
    const f = fixture()
    f.queue.getJob.mockRejectedValue(new Error("Unavailable"))
    await f.service.create("owner", "LINK_CHECK")
    expect(f.prisma.backgroundTask.updateMany).toHaveBeenCalledWith({ where: { id: "task1", status: "PENDING" }, data: { error: expect.any(String) } })
  })
})

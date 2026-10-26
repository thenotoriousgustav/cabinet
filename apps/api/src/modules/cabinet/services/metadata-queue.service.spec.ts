import { MetadataQueueService } from "./metadata-queue.service"

describe("metadata queue", () => {
  function fixture() {
    const prisma = { bookmark: { updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) } }
    const queue = { getJob: jest.fn().mockResolvedValue(null), add: jest.fn() }
    return { prisma, queue, service: new MetadataQueueService(prisma as any, queue as any) }
  }
  it("uses a stable job ID, skips active jobs, and does not enqueue notes without URLs", async () => {
    const f = fixture()
    await f.service.enqueue({ id: "b1", url: "https://react.dev" })
    expect(f.queue.add).toHaveBeenCalledWith("enrich", { bookmarkId: "b1", url: "https://react.dev" }, { jobId: "metadata-b1", removeOnComplete: true, removeOnFail: true })
    f.queue.getJob.mockResolvedValue({ getState: async () => "active" } as any)
    expect(await f.service.enqueue({ id: "b1", url: "https://react.dev" }, true)).toBe(false)
    expect(f.queue.add).toHaveBeenCalledTimes(1)
    expect(await f.service.enqueue({ id: "note", url: null })).toBe(false)
  })
  it("keeps durable pending work when Redis is unavailable", async () => {
    const f = fixture()
    f.queue.getJob.mockRejectedValue(new Error("Redis down"))
    expect(await f.service.enqueue({ id: "b1", url: "https://react.dev" })).toBe(false)
    expect(f.prisma.bookmark.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadataStatus: "PENDING", metadataError: expect.any(String) }) }))
  })
  it("recovers only unfinished web bookmarks, never completed items with missing covers", async () => {
    const f = fixture()
    await f.service.recoverPending()
    expect(f.prisma.bookmark.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { type: "BOOKMARK", url: { not: null }, deletedAt: null, metadataStatus: { in: ["PENDING", "PROCESSING"] } }, take: 100 }))
  })
})

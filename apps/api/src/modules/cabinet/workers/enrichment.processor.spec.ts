import { Job } from "bullmq"
import { EnrichmentProcessor, EnrichmentJobData } from "./enrichment.processor"

function fixture(overrides = {}) {
  const row = { id: "b1", type: "BOOKMARK", url: "https://example.test/read", title: "example.test", metadataStatus: "PENDING", metadataTitlePending: true, ...overrides }
  const prisma = { bookmark: { findUnique: jest.fn().mockResolvedValue(row), updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, $transaction: jest.fn(async (writes) => Promise.all(writes)) }
  const metadata = { extract: jest.fn().mockResolvedValue({ title: "A useful reference", description: "Readable details", imageUrl: "https://example.test/image.png" }) }
  const processor = new EnrichmentProcessor(prisma as any, metadata as any)
  const job = { id: "job-1", data: { bookmarkId: "b1", url: row.url }, attemptsMade: 0, opts: { attempts: 3 } } as Job<EnrichmentJobData>
  return { prisma, metadata, processor, job }
}
describe("EnrichmentProcessor", () => {
  it("fills missing metadata and uses a URL guard on every write", async () => {
    const f = fixture()
    await f.processor.process(f.job)
    expect(f.metadata.extract).toHaveBeenCalledTimes(1)
    for (const [query] of f.prisma.bookmark.updateMany.mock.calls) expect(query.where).toMatchObject({ id: "b1", url: "https://example.test/read", deletedAt: null })
    expect(f.prisma.bookmark.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ title: "example.test" }), data: expect.objectContaining({ title: "A useful reference" }) }))
    expect(f.prisma.bookmark.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ description: null }, { description: "" }] }), data: { description: "Readable details" } }))
    expect(f.prisma.$transaction).toHaveBeenCalled()
  })
  it("never replaces a title supplied by the user", async () => {
    const f = fixture({ title: "My own title", metadataTitlePending: false })
    await f.processor.process(f.job)
    expect(f.prisma.bookmark.updateMany.mock.calls.some(([query]) => "title" in query.data)).toBe(false)
  })
  it.each([{ type: "NOTE" }, { type: "DRAWING" }, { deletedAt: new Date() }, { metadataStatus: "COMPLETED" }])("skips unnecessary jobs: %j", async (row) => {
    const f = fixture(row)
    await f.processor.process(f.job)
    expect(f.metadata.extract).not.toHaveBeenCalled()
    expect(f.prisma.bookmark.updateMany).not.toHaveBeenCalled()
  })
  it("keeps client metadata when a website blocks requests", async () => {
    const f = fixture()
    f.metadata.extract.mockResolvedValue({ unavailable: true } as any)
    await f.processor.process(f.job)
    expect(f.prisma.bookmark.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadataStatus: "FAILED", metadataError: expect.any(String) }) }))
    expect(f.prisma.$transaction).not.toHaveBeenCalled()
  })
  it("marks transient errors pending until attempts are exhausted", async () => {
    const f = fixture()
    f.metadata.extract.mockRejectedValue(new Error("Temporary failure"))
    await expect(f.processor.process(f.job)).rejects.toThrow("Temporary failure")
    expect(f.prisma.bookmark.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadataStatus: "PENDING" }) }))
    f.job.attemptsMade = 2
    await expect(f.processor.process(f.job)).rejects.toThrow()
    expect(f.prisma.bookmark.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadataStatus: "FAILED" }) }))
  })
})

import { LinkCheckerService } from "./link-checker.service"
import { validatePublicUrl } from "@/common/utils/ssrf"
jest.mock("@/common/utils/ssrf", () => ({ validatePublicUrl: jest.fn(async (url: string) => new URL(url)) }))

describe("LinkCheckerService", () => {
  afterEach(() => jest.restoreAllMocks())
  it.each([401, 403, 405, 429, 503])("does not classify HTTP %s as a dead link", async (status) => {
    const updateMany = jest.fn()
    const service = new LinkCheckerService({ bookmark: { updateMany } } as any, {} as any)
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status }))
    expect(await service.checkBookmark({ id: "b1", url: "https://example.test/a" })).toBe("UNKNOWN")
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "b1", url: "https://example.test/a", deletedAt: null }, data: expect.objectContaining({ status: "UNKNOWN", statusCode: status }) }))
  })
  it("still marks missing pages as broken", async () => {
    const updateMany = jest.fn()
    const service = new LinkCheckerService({ bookmark: { updateMany } } as any, {} as any)
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 404 }))
    expect(await service.checkBookmark({ id: "b1", url: "https://example.test/missing" })).toBe("BROKEN")
  })
  it("checks only the requesting account, paginates the entire scan and reports progress", async () => {
    const rows = [{ id: "a", url: "https://example.test/a" }, { id: "b", url: "https://example.test/b" }]
    const prisma = { bookmark: { count: jest.fn().mockResolvedValue(2), findMany: jest.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([]) } }
    const service = new LinkCheckerService(prisma as any, {} as any)
    jest.spyOn(service, "checkBookmark").mockResolvedValue("OK")
    const progress = jest.fn()
    await service.runScan("owner", progress)
    expect(prisma.bookmark.findMany.mock.calls[0][0].where).toMatchObject({ userId: "owner", type: "BOOKMARK", url: { not: null }, deletedAt: null })
    expect(prisma.bookmark.findMany.mock.calls[1][0].where.id).toEqual({ gt: "b" })
    expect(progress).toHaveBeenLastCalledWith(2, 2, 0)
  })
  it("blocks private targets before fetch and does not rewrite a concurrently edited URL", async () => {
    const updateMany = jest.fn()
    const service = new LinkCheckerService({ bookmark: { updateMany } } as any, {} as any)
    jest.mocked(validatePublicUrl).mockRejectedValueOnce(new Error("Private host"))
    const fetch = jest.spyOn(global, "fetch")
    await service.checkBookmark({ id: "b1", url: "http://127.0.0.1/admin" })
    expect(fetch).not.toHaveBeenCalled()
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "b1", url: "http://127.0.0.1/admin", deletedAt: null }, data: expect.objectContaining({ status: "UNKNOWN", statusCode: null }) }))
  })
  it("validates permanent redirect destinations before storing them", async () => {
    const updateMany = jest.fn()
    const service = new LinkCheckerService({ bookmark: { updateMany } } as any, {} as any)
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 301, headers: { location: "http://127.0.0.1/private" } }))
    jest.mocked(validatePublicUrl).mockResolvedValueOnce(new URL("https://example.test/a")).mockRejectedValueOnce(new Error("Private target"))
    await service.checkBookmark({ id: "b1", url: "https://example.test/a" })
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ url: expect.any(String) }) }))
  })
})

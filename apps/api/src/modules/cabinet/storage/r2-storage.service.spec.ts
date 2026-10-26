import { BadRequestException, NotFoundException } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { R2StorageService } from "./r2-storage.service"

describe("R2StorageService", () => {
  let service: R2StorageService
  let sendMock: jest.Mock

  beforeEach(() => {
    sendMock = jest.fn().mockResolvedValue({})
    const config = {
      get: jest.fn((key: string) => {
        if (key === "R2_ENDPOINT") return "https://example.r2.cloudflarestorage.com"
        if (key === "R2_ACCESS_KEY_ID") return "test-key"
        if (key === "R2_SECRET_ACCESS_KEY") return "test-secret"
        if (key === "R2_BUCKET_NAME") return "cabinet-test"
        if (key === "R2_PUBLIC_URL") return "https://pub.example.r2.dev"
        if (key === "API_URL") return "http://localhost:4000"
        return undefined
      }),
    } as unknown as ConfigService

    service = new R2StorageService(config)
    ;(service as any).s3.send = sendMock
  })

  afterEach(() => jest.clearAllMocks())

  it("uploads valid PDF within size limit and returns public URL", async () => {
    const buffer = Buffer.from("%PDF-1.4 test content")
    const result = await service.uploadFile({
      userId: "user-123",
      buffer,
      filename: "Report 2026.pdf",
      mimeType: "application/pdf",
    })

    expect(result.contentType).toBe("application/pdf")
    expect(result.filename).toBe("Report 2026.pdf")
    expect(result.size).toBe(buffer.length)
    expect(result.key).toMatch(/^uploads\/user-123\/\d{4}-\d{2}\/[a-f0-9-]+-Report_2026\.pdf$/)
    expect(result.url).toBe(`https://pub.example.r2.dev/${result.key}`)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it("uploads valid Image (JPEG, PNG, WebP) within size limit", async () => {
    const buffer = Buffer.from("fake-image-bytes")
    const result = await service.uploadFile({
      userId: "user-123",
      buffer,
      filename: "screenshot.png",
      mimeType: "image/png",
    })

    expect(result.contentType).toBe("image/png")
    expect(result.key).toContain("screenshot.png")
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it("rejects disallowed MIME types", async () => {
    const buffer = Buffer.from("alert(1)")
    await expect(
      service.uploadFile({
        userId: "user-123",
        buffer,
        filename: "script.js",
        mimeType: "application/javascript",
      })
    ).rejects.toThrow(BadRequestException)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("rejects PDF exceeding 50MB", async () => {
    const largeBuffer = { length: 51 * 1024 * 1024 } as unknown as Buffer
    await expect(
      service.uploadFile({
        userId: "user-123",
        buffer: largeBuffer,
        filename: "huge.pdf",
        mimeType: "application/pdf",
      })
    ).rejects.toThrow(/File exceeds maximum allowed size/)
  })

  it("rejects Image exceeding 15MB", async () => {
    const largeBuffer = { length: 16 * 1024 * 1024 } as unknown as Buffer
    await expect(
      service.uploadFile({
        userId: "user-123",
        buffer: largeBuffer,
        filename: "huge.jpg",
        mimeType: "image/jpeg",
      })
    ).rejects.toThrow(/File exceeds maximum allowed size/)
  })

  it("falls back to API proxy URL when R2_PUBLIC_URL is not set", async () => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === "R2_ENDPOINT") return "https://example.r2.cloudflarestorage.com"
        if (key === "R2_BUCKET_NAME") return "cabinet"
        if (key === "API_URL") return "http://localhost:4000"
        return undefined
      }),
    } as unknown as ConfigService

    const privateService = new R2StorageService(config)
    ;(privateService as any).s3.send = sendMock

    const result = await privateService.uploadFile({
      userId: "user-456",
      buffer: Buffer.from("test"),
      filename: "test.webp",
      mimeType: "image/webp",
    })

    expect(result.url).toBe(`http://localhost:4000/v1/uploads/file/${result.key}`)
  })

  it("rejects path traversal attempts in getFileStream", async () => {
    await expect(service.getFileStream("../secret.txt")).rejects.toThrow(BadRequestException)
    await expect(service.getFileStream("/etc/passwd")).rejects.toThrow(BadRequestException)
  })

  it("handles NoSuchKey gracefully with NotFoundException", async () => {
    sendMock.mockRejectedValue({ name: "NoSuchKey" })
    await expect(service.getFileStream("uploads/missing.pdf")).rejects.toThrow(NotFoundException)
  })
})

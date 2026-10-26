jest.mock("@/auth/guards/auth.guard", () => ({ AuthGuard: class {} }))

import { BadRequestException } from "@nestjs/common"
import { BookmarkContentType } from "@prisma/client"
import { UploadsController } from "./uploads.controller"

describe("UploadsController", () => {
  let controller: UploadsController
  let storage: any
  let bookmarks: any

  beforeEach(() => {
    storage = {
      uploadFile: jest.fn().mockResolvedValue({
        url: "https://pub.example.r2.dev/uploads/u1/doc.pdf",
        key: "uploads/u1/doc.pdf",
        filename: "doc.pdf",
        contentType: "application/pdf",
        size: 2048,
      }),
      getFileStream: jest.fn(),
    }
    bookmarks = {
      create: jest.fn().mockResolvedValue({ id: "bm-1" }),
    }
    controller = new UploadsController(storage, bookmarks)
  })

  it("throws BadRequestException if no file is provided", async () => {
    await expect(controller.upload({ id: "u1" }, undefined)).rejects.toThrow(BadRequestException)
    await expect(controller.uploadBookmark({ id: "u1" }, undefined)).rejects.toThrow(BadRequestException)
  })

  it("calls storage.uploadFile and returns file metadata", async () => {
    const file = {
      buffer: Buffer.from("data"),
      originalname: "doc.pdf",
      mimetype: "application/pdf",
    } as Express.Multer.File

    const result = await controller.upload({ id: "u1" }, file)
    expect(storage.uploadFile).toHaveBeenCalledWith({
      userId: "u1",
      buffer: file.buffer,
      filename: "doc.pdf",
      mimeType: "application/pdf",
    })
    expect(result.url).toBe("https://pub.example.r2.dev/uploads/u1/doc.pdf")
  })

  it("creates a PDF bookmark with contentType: PDF and siteName: PDF Document", async () => {
    const file = {
      buffer: Buffer.from("%PDF"),
      originalname: "Spec.pdf",
      mimetype: "application/pdf",
    } as Express.Multer.File

    await controller.uploadBookmark(
      { id: "u1" },
      file,
      { title: "System Spec", folderId: "f-1", tags: "specs, v1" }
    )

    expect(bookmarks.create).toHaveBeenCalledWith("u1", {
      url: "https://pub.example.r2.dev/uploads/u1/doc.pdf",
      imageUrl: undefined,
      title: "System Spec",
      description: "PDF Document (2 KB)",
      siteName: "PDF Document",
      contentType: BookmarkContentType.PDF,
      folderId: "f-1",
      tags: ["specs", "v1"],
      source: "WEB",
    })
  })

  it("creates an Image bookmark with contentType: IMAGE and imageUrl set", async () => {
    storage.uploadFile.mockResolvedValueOnce({
      url: "https://pub.example.r2.dev/uploads/u1/pic.png",
      key: "uploads/u1/pic.png",
      filename: "pic.png",
      contentType: "image/png",
      size: 4096,
    })

    const file = {
      buffer: Buffer.from("image"),
      originalname: "pic.png",
      mimetype: "image/png",
    } as Express.Multer.File

    await controller.uploadBookmark({ id: "u1" }, file, { tags: ["inspiration"] })

    expect(bookmarks.create).toHaveBeenCalledWith("u1", {
      url: "https://pub.example.r2.dev/uploads/u1/pic.png",
      imageUrl: "https://pub.example.r2.dev/uploads/u1/pic.png",
      title: "pic.png",
      description: undefined,
      siteName: "Image",
      contentType: BookmarkContentType.IMAGE,
      folderId: undefined,
      tags: ["inspiration"],
      source: "WEB",
    })
  })
})

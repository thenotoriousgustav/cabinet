import {
  Controller,
  Post,
  Get,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  Param,
  Req,
  Res,
  BadRequestException,
} from "@nestjs/common"
import { FileInterceptor } from "@nestjs/platform-express"
import { ApiTags, ApiOperation, ApiConsumes, ApiCookieAuth, ApiParam } from "@nestjs/swagger"
import type { Response } from "express"
import { AuthGuard } from "@/auth/guards/auth.guard"
import { Public } from "@/common/decorators/public.decorator"
import { CurrentUser } from "@/common/decorators/current-user.decorator"
import { BookmarkContentType } from "@prisma/client"
import { R2StorageService } from "./r2-storage.service"
import { BookmarksService } from "../bookmarks/bookmarks.service"

@ApiTags("uploads")
@ApiCookieAuth()
@Controller("v1/uploads")
@UseGuards(AuthGuard)
export class UploadsController {
  constructor(
    private readonly storage: R2StorageService,
    private readonly bookmarks: BookmarksService
  ) {}

  @Post()
  @ApiOperation({ summary: "Upload an image or PDF to Cloudflare R2" })
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @CurrentUser() user: any,
    @UploadedFile() file?: Express.Multer.File
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException("No file provided for upload")
    }

    return this.storage.uploadFile({
      userId: user.id,
      buffer: file.buffer,
      filename: file.originalname || "upload",
      mimeType: file.mimetype,
    })
  }

  @Post("bookmark")
  @ApiOperation({ summary: "Upload a PDF or image and save directly as a library bookmark" })
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file"))
  async uploadBookmark(
    @CurrentUser() user: any,
    @UploadedFile() file?: Express.Multer.File,
    @Body() body: { title?: string; description?: string; folderId?: string; tags?: string | string[] } = {}
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException("No file provided for upload")
    }

    const uploaded = await this.storage.uploadFile({
      userId: user.id,
      buffer: file.buffer,
      filename: file.originalname || "upload",
      mimeType: file.mimetype,
    })

    const isPdf = uploaded.contentType === "application/pdf"
    const isImage = uploaded.contentType.startsWith("image/")
    const contentType = isPdf
      ? BookmarkContentType.PDF
      : isImage
        ? BookmarkContentType.IMAGE
        : BookmarkContentType.UNKNOWN

    const tagsArray = Array.isArray(body.tags)
      ? body.tags
      : typeof body.tags === "string" && body.tags.trim()
        ? body.tags.split(",").map((t) => t.trim()).filter(Boolean)
        : []

    return this.bookmarks.create(user.id, {
      url: uploaded.url,
      imageUrl: isImage ? uploaded.url : undefined,
      title: body.title?.trim() || uploaded.filename,
      description: body.description?.trim() || (isPdf ? `PDF Document (${Math.round(uploaded.size / 1024)} KB)` : undefined),
      siteName: isPdf ? "PDF Document" : isImage ? "Image" : undefined,
      contentType,
      folderId: body.folderId || undefined,
      tags: tagsArray,
      source: "WEB",
    })
  }

  @Public()
  @Get("file/*")
  @ApiOperation({ summary: "Serve an uploaded file from R2 via API proxy if needed" })
  @ApiParam({ name: "path", required: true, description: "Object key" })
  async serveFile(@Req() req: any, @Res() res: Response) {
    const prefix = "/v1/uploads/file/"
    const urlStr = req.originalUrl || req.url || ""
    const idx = urlStr.indexOf(prefix)
    const key = idx !== -1 ? decodeURIComponent(urlStr.slice(idx + prefix.length).split("?")[0]) : ""
    if (!key) {
      throw new BadRequestException("Object key is required")
    }
    const { stream, contentType, contentLength } = await this.storage.getFileStream(key)

    res.setHeader("Content-Type", contentType || "application/octet-stream")
    if (contentLength) res.setHeader("Content-Length", contentLength)
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
    res.setHeader("Content-Disposition", "inline")
    stream.pipe(res)
  }
}

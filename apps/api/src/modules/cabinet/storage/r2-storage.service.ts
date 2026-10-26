import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3"
import { Readable } from "node:stream"
import { randomUUID } from "node:crypto"

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
])

const MAX_PDF_BYTES = 50 * 1024 * 1024 // 50 MB
const MAX_IMAGE_BYTES = 15 * 1024 * 1024 // 15 MB

export interface UploadResult {
  url: string
  key: string
  filename: string
  contentType: string
  size: number
}

@Injectable()
export class R2StorageService {
  private readonly logger = new Logger(R2StorageService.name)
  private readonly s3: S3Client
  private readonly bucket: string
  private readonly publicUrl?: string
  private readonly apiUrl: string

  constructor(private readonly config: ConfigService) {
    const endpoint = config.get<string>("R2_ENDPOINT")
    const accessKeyId = config.get<string>("R2_ACCESS_KEY_ID")
    const secretAccessKey = config.get<string>("R2_SECRET_ACCESS_KEY")
    this.bucket = config.get<string>("R2_BUCKET_NAME") || "cabinet"
    this.publicUrl = config.get<string>("R2_PUBLIC_URL")?.replace(/\/+$/, "")
    this.apiUrl = config.get<string>("API_URL") || "http://localhost:4000"

    this.s3 = new S3Client({
      region: "auto",
      endpoint,
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    })
  }

  async uploadFile(params: {
    userId: string
    buffer: Buffer
    filename: string
    mimeType: string
  }): Promise<UploadResult> {
    const mime = params.mimeType.toLowerCase()
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      throw new BadRequestException(
        "Only images (JPEG, PNG, WebP, GIF, SVG) and PDF documents are allowed"
      )
    }

    const isPdf = mime === "application/pdf"
    const maxBytes = isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
    if (params.buffer.length > maxBytes) {
      throw new BadRequestException(
        `File exceeds maximum allowed size of ${isPdf ? "50MB" : "15MB"}`
      )
    }

    const now = new Date()
    const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
    const sanitized = params.filename
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 100) || (isPdf ? "document.pdf" : "image.jpg")
    const key = `uploads/${params.userId}/${yearMonth}/${randomUUID()}-${sanitized}`

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: params.buffer,
          ContentType: mime,
        })
      )
    } catch (err: any) {
      this.logger.error(`Failed to upload to R2 bucket "${this.bucket}": ${err.message}`, err.stack)
      throw new BadRequestException("Storage upload failed. Please verify R2 credentials and bucket configuration.")
    }

    const url = this.publicUrl
      ? `${this.publicUrl}/${key}`
      : `${this.apiUrl}/v1/uploads/file/${key}`

    return {
      url,
      key,
      filename: params.filename,
      contentType: mime,
      size: params.buffer.length,
    }
  }

  async getFileStream(key: string): Promise<{
    stream: Readable
    contentType?: string
    contentLength?: number
  }> {
    if (key.includes("..") || key.startsWith("/")) {
      throw new BadRequestException("Invalid object key")
    }

    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      )

      if (!response.Body) {
        throw new NotFoundException("File not found")
      }

      return {
        stream: response.Body as Readable,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
      }
    } catch (err: any) {
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
        throw new NotFoundException("File not found")
      }
      this.logger.error(`Error reading key ${key} from R2: ${err.message}`)
      throw err
    }
  }
}

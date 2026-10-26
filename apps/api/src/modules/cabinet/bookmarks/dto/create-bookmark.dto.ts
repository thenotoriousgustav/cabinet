import { ApiPropertyOptional } from "@nestjs/swagger"
import {
  IsArray,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from "class-validator"
import { BookmarkType, BookmarkContentType } from "@prisma/client"

export class CreateBookmarkDto {
  @ApiPropertyOptional({ enum: ["WEB", "EXTENSION", "IMPORT"], description: "Client source used for getting-started progress" })
  @IsIn(["WEB", "EXTENSION", "IMPORT"])
  @IsOptional()
  source?: "WEB" | "EXTENSION" | "IMPORT"

  @ApiPropertyOptional({ enum: BookmarkContentType, description: "Content type declared by the page" })
  @IsEnum(BookmarkContentType)
  @IsOptional()
  contentType?: BookmarkContentType

  @ApiPropertyOptional({ description: "Stable request UUID, reused only when retrying the same creation" })
  @IsUUID()
  @IsOptional()
  clientRequestId?: string

  @ApiPropertyOptional({ description: "Account that owns an offline request; reject replay under another session" })
  @IsUUID()
  @IsOptional()
  expectedUserId?: string

  @ApiPropertyOptional({
    example: "https://nextjs.org",
    description: "URL (optional for standalone notes)",
  })
  @IsString()
  @IsOptional()
  url?: string

  @ApiPropertyOptional({
    enum: BookmarkType,
    default: BookmarkType.BOOKMARK,
    description: "Item type: BOOKMARK or NOTE",
  })
  @IsEnum(BookmarkType)
  @IsOptional()
  type?: BookmarkType

  @ApiPropertyOptional({
    example: "My Note / Bookmark Title",
    description: "Title (auto-extracted if omitted for URLs)",
  })
  @IsString()
  @IsOptional()
  title?: string

  @ApiPropertyOptional({
    example: "Quick summary or excerpt",
    description: "Short description",
  })
  @IsString()
  @IsOptional()
  description?: string

  @ApiPropertyOptional({
    example: "https://example.com/cover.png",
    description: "Preview image read from the page by the client, used when the server cannot fetch the page",
  })
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @MaxLength(2048)
  @IsOptional()
  imageUrl?: string

  @ApiPropertyOptional({
    example: "https://example.com/favicon.ico",
    description: "Favicon read from the page by the client",
  })
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @MaxLength(2048)
  @IsOptional()
  faviconUrl?: string

  @ApiPropertyOptional({
    example: "Medium",
    description: "Site name read from the page by the client",
  })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  siteName?: string

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    description: "Structured note content",
  })
  @IsObject()
  @IsOptional()
  noteDocument?: Record<string, any>

  @ApiPropertyOptional({
    example: "123e4567-e89b-12d3-a456-426614174000",
    description: "Folder ID",
  })
  @IsUUID()
  @IsOptional()
  folderId?: string

  @ApiPropertyOptional({
    example: ["React", "Architecture"],
    description: "List of tags",
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[]
}

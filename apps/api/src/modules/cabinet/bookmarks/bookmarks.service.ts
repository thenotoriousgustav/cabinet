import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common"
import {
  BookmarkType,
  BookmarkContentType,
  MetadataStatus,
} from "@prisma/client"
import { Response } from "express"
import axios from "axios"
import { PrismaService } from "@/prisma/prisma.service"
import { MetadataService } from "@/modules/cabinet/services/metadata.service"
import { CabinetMediaService } from "@/modules/cabinet/services/cabinet-media.service"
import { CreateBookmarkDto } from "./dto/create-bookmark.dto"
import { UpdateBookmarkDto } from "./dto/update-bookmark.dto"
import { DownloadMediaDto } from "@/modules/cabinet/dto/download-media.dto"
import { SaveNoteDto } from "./dto/save-note.dto"
import { SaveDrawingDto } from "./dto/save-drawing.dto"
import { CRAWLER_USER_AGENTS } from "@/modules/cabinet/providers/metadata/metadata-provider.interface"
import { validatePublicUrl } from "@/common/utils/ssrf"
import { BookmarkSort, bookmarkOrderBy, bookmarkSortFields } from "./bookmark-order"
import { accessibleFolder, editableBookmark, editableFolder, folderSummary, shareableNoteFields, viewableBookmark, writableFolder } from "../folders/folder-access"
import { frameBlockedByHeaders } from "./embed-policy"
import { noteDocumentText } from "./note-text"
import { bookmarkSearchQuery, searchRefinements } from "./bookmark-search"
import { parseBookmarkImport } from "./bookmark-import"
import { BackgroundTasksService, stableTaskId } from "../services/background-tasks.service"
import { MetadataQueueService } from "../services/metadata-queue.service"
import {
  MAX_PROXIED_PAGE_BYTES,
  decodeHtml,
  fetchWithBrowserFallback,
  isBlockedResponse,
  isHtmlContentType,
  proxiedPageHeaders,
  proxyErrorPage,
  rewriteProxiedPage,
  type PreviewErrorReason,
} from "./page-proxy"

/** Only saved links can duplicate each other; several highlights may share their page's address. */
const duplicateCandidates = (userId: string) => ({ userId, deletedAt: null, type: BookmarkType.BOOKMARK })

@Injectable()
export class BookmarksService {
  constructor(
    private prisma: PrismaService,
    private metadataService: MetadataService,
    private cabinetMediaService: CabinetMediaService,
    private metadataQueue: MetadataQueueService,
    private tasks: BackgroundTasksService,
  ) {}

  savedSearches(userId: string) {
    return this.prisma.savedSearch.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })
  }

  saveSearch(userId: string, dto: { name: string; url: string }) {
    if (!dto.name.trim()) throw new BadRequestException("Enter a search name")
    return this.prisma.savedSearch.create({ data: { userId, name: dto.name.trim(), url: dto.url } })
  }

  deleteSearch(userId: string, id: string) {
    return this.prisma.savedSearch.deleteMany({ where: { id, userId } })
  }

  async create(userId: string, createBookmarkDto: CreateBookmarkDto) {
    if (createBookmarkDto.expectedUserId && createBookmarkDto.expectedUserId !== userId) throw new ForbiddenException("This save belongs to another account")
    const requestWhere = createBookmarkDto.clientRequestId
      ? { userId_clientRequestId: { userId, clientRequestId: createBookmarkDto.clientRequestId } }
      : null
    if (requestWhere) {
      const previous = await this.prisma.bookmark.findUnique({ where: requestWhere, include: { tags: true, folder: { select: folderSummary } } })
      if (previous) return previous
    }
    const isNote =
      createBookmarkDto.type === BookmarkType.NOTE || !createBookmarkDto.url
    const itemType = isNote ? BookmarkType.NOTE : BookmarkType.BOOKMARK
    if (
      createBookmarkDto.noteDocument &&
      (!isNote ||
        createBookmarkDto.noteDocument.type !== "doc" ||
        !Array.isArray(createBookmarkDto.noteDocument.content))
    ) {
      throw new BadRequestException("Invalid note document")
    }

    let fallbackTitle = "Untitled Note"
    if (!isNote) {
      try {
        const url = new URL(createBookmarkDto.url!)
        if (!["http:", "https:"].includes(url.protocol)) throw new Error()
        fallbackTitle = url.hostname.replace(/^www\./, "")
      } catch { throw new BadRequestException("Enter an HTTP or HTTPS URL") }
    }
    const title = createBookmarkDto.title?.trim() || fallbackTitle
    const hasMetadata = !!(createBookmarkDto.title?.trim() && createBookmarkDto.description?.trim() && createBookmarkDto.imageUrl)
    const contentType = !isNote && this.cabinetMediaService.isVideoUrl(createBookmarkDto.url!) ? BookmarkContentType.VIDEO : isNote ? null : createBookmarkDto.contentType ?? null

    // 2. Prep tags
    const tagConnectOrCreate =
      createBookmarkDto.tags?.map((name) => {
        const formatted = name.trim().toLowerCase()
        return {
          where: { name_userId: { name: formatted, userId } },
          create: { name: formatted, userId },
        }
      }) || []

    // 3. Check folder ownership if folderId is specified
    if (createBookmarkDto.folderId) {
      const folder = await this.prisma.folder.findFirst({
        where: { id: createBookmarkDto.folderId, ...writableFolder(userId) },
      })
      if (!folder) {
        throw new NotFoundException("Target folder not found")
      }
    }

    const creation = {
      data: {
        clientRequestId: createBookmarkDto.clientRequestId,
        type: itemType,
        url: createBookmarkDto.url || null,
        title,
        ...bookmarkSortFields({ title, url: createBookmarkDto.url || null }),
        description: createBookmarkDto.description?.trim() || null,
        source: createBookmarkDto.source || "WEB",
        metadataTitlePending: !isNote && !createBookmarkDto.title?.trim(),
        // Search reads a note's plain text, e.g. a highlight saved from the browser extension.
        notes: createBookmarkDto.noteDocument ? noteDocumentText(createBookmarkDto.noteDocument) : null,
        noteDocument: createBookmarkDto.noteDocument,
        imageUrl: createBookmarkDto.imageUrl || null,
        faviconUrl: createBookmarkDto.faviconUrl || null,
        siteName: createBookmarkDto.siteName || null,
        folderId: createBookmarkDto.folderId || null,
        userId,
        contentType: contentType || (isNote ? null : undefined),
        metadataStatus: isNote || hasMetadata
          ? MetadataStatus.COMPLETED
          : MetadataStatus.PENDING,
        tags: {
          connectOrCreate: tagConnectOrCreate,
        },
      },
      include: {
        tags: true,
        folder: { select: folderSummary },
      },
    }
    let bookmark
    try {
      bookmark = await this.prisma.bookmark.create(creation)
    } catch (error) {
      if (!requestWhere || (error as { code?: string }).code !== "P2002") throw error
      bookmark = await this.prisma.bookmark.findUnique({ where: requestWhere, include: creation.include })
      if (!bookmark) throw error
    }

    if (createBookmarkDto.source === "EXTENSION") await this.prisma.user.updateMany({
      where: { id: userId, extensionLastSeenAt: null }, data: { extensionLastSeenAt: new Date() },
    })
    if (!isNote && bookmark.url && !hasMetadata) await this.metadataQueue.enqueue(bookmark)
    return bookmark
  }

  async saveNote(userId: string, id: string, dto: SaveNoteDto) {
    if (dto.expectedUserId && dto.expectedUserId !== userId) throw new ForbiddenException("This draft belongs to another account")
    if (
      dto.noteDocument.type !== "doc" ||
      !Array.isArray(dto.noteDocument.content)
    ) {
      throw new BadRequestException("Invalid note document")
    }
    const where = { id, userId, type: BookmarkType.NOTE, deletedAt: null }
    const existing = await this.prisma.bookmark.findFirst({ where: { id } })
    if (existing && (existing.type !== BookmarkType.NOTE || existing.deletedAt)) {
      throw new NotFoundException("Note not found")
    }
    if ((dto.baseRevision === undefined) !== (dto.saveId === undefined)) {
      throw new BadRequestException("Both baseRevision and saveId are required for versioned saves")
    }
    const versioned = dto.baseRevision !== undefined
    const revisionData = { noteRevision: { increment: 1 }, noteSaveId: dto.saveId ?? null }
    const conflict = () => new ConflictException("This note changed in another tab or device. Reload the saved note or explicitly keep your draft.")
    const checkRevision = () => {
      if (versioned && (existing?.noteRevision ?? 0) !== dto.baseRevision) throw conflict()
    }
    if (existing && existing.userId !== userId) {
      // Editors of a shared folder change a note's title and content; its folder and tags stay with the author.
      const editable = existing.folderId
        ? await this.prisma.folder.findFirst({ where: { id: existing.folderId, ...editableFolder(userId) }, select: { id: true } })
        : null
      if (!editable) throw new NotFoundException("Note not found")
      if (dto.saveId && existing.noteSaveId === dto.saveId) return { ...existing, tags: [], canEdit: false, access: "editor" as const }
      checkRevision()
      const title = dto.title?.trim() || "Untitled note"
      const updated = await this.prisma.bookmark.update({
        where: { id, ...(versioned ? { noteRevision: dto.baseRevision } : {}) },
        data: { title, ...bookmarkSortFields({ title }), notes: dto.notes ?? "", noteDocument: dto.noteDocument, ...revisionData },
        include: { tags: true, folder: { select: folderSummary } },
      }).catch(async (error) => {
        if ((error as { code?: string }).code === "P2025" && versioned) {
          const latest = await this.prisma.bookmark.findFirst({ where: { id, type: BookmarkType.NOTE, deletedAt: null } })
          if (latest?.noteSaveId === dto.saveId) return latest
          throw conflict()
        }
        throw error
      })
      return { ...updated, tags: [], canEdit: false, access: "editor" as const }
    }
    if (dto.folderId) {
      const folder = await this.prisma.folder.findFirst({
        where: { id: dto.folderId, ...writableFolder(userId) },
      })
      if (!folder) throw new NotFoundException("Folder not found")
    }
    const tagNames = dto.tags
      ?.map((name) => name.replace(/^#/, "").trim().toLowerCase())
      .filter(Boolean)
    const data = {
      title: dto.title?.trim() || "Untitled note",
      ...bookmarkSortFields({ title: dto.title?.trim() || "Untitled note" }),
      notes: dto.notes ?? "",
      noteDocument: dto.noteDocument,
      ...(dto.folderId !== undefined && existing ? { folderId: dto.folderId || null } : {}),
    }
    const tags = tagNames
      ? {
          connectOrCreate: [...new Set(tagNames)].map((name) => ({
            where: { name_userId: { name, userId } },
            create: { name, userId },
          })),
        }
      : undefined
    const include = { tags: true, folder: { select: folderSummary } }
    if (dto.saveId && existing?.noteSaveId === dto.saveId) return existing
    checkRevision()
    try {
      if (versioned) {
        if (existing) return await this.prisma.bookmark.update({
          where: { ...where, noteRevision: dto.baseRevision },
          data: { ...data, ...revisionData, tags: tags && { set: [], ...tags } },
          include,
        })
        return await this.prisma.bookmark.create({
          data: { id, userId, folderId: dto.folderId || null, type: BookmarkType.NOTE, metadataStatus: MetadataStatus.COMPLETED, ...data, noteRevision: 1, noteSaveId: dto.saveId, tags },
          include,
        })
      }
      // A stable client-generated UUID makes retries safe after a lost response.
      return await this.prisma.bookmark.upsert({
        where,
        create: {
          id,
          userId,
          folderId: dto.folderId || null,
          type: BookmarkType.NOTE,
          metadataStatus: MetadataStatus.COMPLETED,
          ...data,
          tags,
        },
        update: { ...data, ...revisionData, tags: tags && { set: [], ...tags } },
        include,
      })
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code !== "P2002" && code !== "P2025") throw error
      if (versioned) {
        const latest = await this.prisma.bookmark.findFirst({ where })
        if (latest?.noteSaveId === dto.saveId) return latest
        throw conflict()
      }
      // An existing ID is writable only by its owner, and only while it is an active note.
      const note = await this.prisma.bookmark.findFirst({ where })
      if (!note) throw new NotFoundException("Note not found")
      return this.prisma.bookmark.update({
        where,
        data: { ...data, ...revisionData, tags: tags && { set: [], ...tags } },
        include,
      })
    }
  }

  /**
   * Creates or autosaves a drawing under a stable client-generated id, like a note.
   * Editors of a shared folder change its title and scene; its folder and tags stay with the author.
   */
  async saveDrawing(userId: string, id: string, dto: SaveDrawingDto) {
    const scene = dto.scene
    if (!scene || !Array.isArray(scene.elements)) {
      throw new BadRequestException("Invalid drawing")
    }
    const drawing = {
      elements: scene.elements,
      appState: scene.appState && typeof scene.appState === "object" ? scene.appState : {},
      files: scene.files && typeof scene.files === "object" ? scene.files : {},
    }
    const title = dto.title?.trim() || "Untitled drawing"
    const content = {
      title,
      ...bookmarkSortFields({ title }),
      drawing,
      // An empty preview means the canvas was cleared.
      ...(dto.preview !== undefined ? { imageUrl: dto.preview || null } : {}),
    }
    const select = { omit: { drawing: true }, include: { tags: true, folder: { select: folderSummary } } } as const

    const existing = await this.prisma.bookmark.findFirst({ where: { id }, select: { userId: true, type: true, deletedAt: true, folderId: true } })
    if (existing && (existing.type !== BookmarkType.DRAWING || existing.deletedAt)) {
      throw new NotFoundException("Drawing not found")
    }
    if (existing && existing.userId !== userId) {
      const editable = existing.folderId
        ? await this.prisma.folder.findFirst({ where: { id: existing.folderId, ...editableFolder(userId) }, select: { id: true } })
        : null
      if (!editable) throw new NotFoundException("Drawing not found")
      const updated = await this.prisma.bookmark.update({ where: { id }, data: content, ...select })
      return { ...updated, tags: [], canEdit: false, access: "editor" as const }
    }

    if (dto.folderId) {
      const folder = await this.prisma.folder.findFirst({ where: { id: dto.folderId, ...writableFolder(userId) } })
      if (!folder) throw new NotFoundException("Folder not found")
    }
    const tagNames = dto.tags?.map((name) => name.replace(/^#/, "").trim().toLowerCase()).filter(Boolean)
    const tags = tagNames
      ? {
          connectOrCreate: [...new Set(tagNames)].map((name) => ({
            where: { name_userId: { name, userId } },
            create: { name, userId },
          })),
        }
      : undefined
    const owned = { ...content, ...(dto.folderId !== undefined && existing ? { folderId: dto.folderId || null } : {}) }
    const where = { id, userId, type: BookmarkType.DRAWING, deletedAt: null }
    try {
      // A stable client-generated UUID makes retries safe after a lost response.
      return await this.prisma.bookmark.upsert({
        where,
        create: {
          id,
          userId,
          folderId: dto.folderId || null,
          type: BookmarkType.DRAWING,
          metadataStatus: MetadataStatus.COMPLETED,
          ...content,
          tags,
        },
        update: { ...owned, tags: tags && { set: [], ...tags } },
        ...select,
      })
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code !== "P2002" && code !== "P2025") throw error
      const mine = await this.prisma.bookmark.findFirst({ where })
      if (!mine) throw new NotFoundException("Drawing not found")
      return this.prisma.bookmark.update({ where, data: { ...owned, tags: tags && { set: [], ...tags } }, ...select })
    }
  }

  async refreshEnrichment(userId: string, id: string) {
    const bookmark = await this.prisma.bookmark.findFirst({
      where: { id, userId, deletedAt: null },
    })

    if (!bookmark) {
      throw new NotFoundException("Bookmark not found")
    }

    if (bookmark.type !== BookmarkType.BOOKMARK || !bookmark.url) throw new BadRequestException("Only web bookmarks have metadata")
    await this.metadataQueue.enqueue(bookmark, true)
    return this.findOne(userId, id)
  }

  async findAll(
    userId: string,
    filters: {
      folderId?: string
      isFavorite?: boolean
      isArchived?: boolean
      isTrash?: boolean
      tag?: string
      search?: string
      cursor?: string
      limit?: number
      status?: string
      type?: BookmarkType
      contentType?: BookmarkContentType
      sort?: BookmarkSort
      domain?: string
      addedAfter?: string
      addedBefore?: string
    }
  ) {
    if (filters.sort !== undefined && !Object.values(BookmarkSort).includes(filters.sort)) {
      throw new BadRequestException("Invalid bookmark sort")
    }
    if (filters.limit !== undefined && (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 100)) {
      throw new BadRequestException("Limit must be an integer between 1 and 100")
    }
    const refinements = searchRefinements(filters)
    // ponytail: single where condition handles both active items and trash
    const where: any = {
      userId,
      deletedAt: filters.isTrash ? { not: null } : null,
    }

    if (refinements.domain) where.sortDomain = refinements.domain
    if (refinements.after || refinements.before) where.createdAt = {
      ...(refinements.after ? { gte: refinements.after } : {}),
      ...(refinements.before ? { lt: refinements.before } : {}),
    }
    if (filters.type) {
      where.type = filters.type
    }

    if (filters.contentType) {
      where.contentType = filters.contentType
    }

    if (filters.folderId) {
      const folder = await this.prisma.folder.findFirst({
        where: { id: filters.folderId, ...accessibleFolder(userId) },
        select: { id: true },
      })
      if (!folder) throw new NotFoundException("Folder not found")
      where.folderId = filters.folderId
      if (!filters.isTrash) {
        // Everything in a shared folder, links and notes, is visible to people with access.
        delete where.userId
      }
    }

    if (filters.isFavorite !== undefined) {
      where.isFavorite = filters.isFavorite
    }

    if (filters.isArchived !== undefined) {
      where.isArchived = filters.isArchived
    }

    if (filters.status) {
      where.status = filters.status
      if (filters.status === "BROKEN" || filters.status === "REDIRECTED") {
        where.type = BookmarkType.BOOKMARK
        where.url = { not: null }
      }
    }

    if (filters.tag) {
      where.tags = {
        some: {
          name: filters.tag.trim().toLowerCase(),
        },
      }
    }

    if (filters.search) {
      if (!filters.folderId && !filters.isTrash && filters.isFavorite === undefined && filters.isArchived === undefined && !filters.tag && !filters.status && !filters.type && !filters.contentType) {
        // Only unscoped global search adds shared links; scoped personal queues stay personal.
        delete where.userId
        where.AND = [{ OR: [{ userId }, { folder: { is: accessibleFolder(userId) } }] }]
      }
      // Search is ranked in PostgreSQL; Prisma reapplies access when fetching the actual rows.

    }

    const ranked = filters.search?.trim()
      ? await this.prisma.$queryRaw<Array<{ id: string; total: number }>>(bookmarkSearchQuery(userId, filters))
      : null
    if (ranked) where.id = { in: ranked.map((row) => row.id) }
    const take = filters.limit
    const findParams: any = {
      where,
      // A drawing's scene can be large; lists carry its preview image instead.
      omit: { drawing: true },
      include: {
        tags: true,
        folder: { select: folderSummary },
      },
      orderBy: bookmarkOrderBy(filters.sort),
    }

    if (take !== undefined && !ranked) {
      findParams.take = take + 1
      if (filters.cursor) {
        findParams.cursor = { id: filters.cursor }
        findParams.skip = 1
      }
    }

    const itemsPromise = this.prisma.bookmark.findMany(findParams)
    const countPromise = ranked
      ? Promise.resolve(filters.cursor ? undefined : ranked[0]?.total ?? 0)
      : filters.cursor ? Promise.resolve(undefined) : this.prisma.bookmark.count({ where })

    const editableFolderIdsPromise = this.prisma.folder.findMany({
      where: editableFolder(userId),
      select: { id: true },
    })
    const [items, totalCount, editableFolders] = await Promise.all([
      itemsPromise,
      countPromise,
      editableFolderIdsPromise,
    ])
    const editableFolderIds = new Set(editableFolders.map((folder) => folder.id))

    if (ranked) {
      const positions = new Map(ranked.map((row, index) => [row.id, index]))
      items.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!)
    }
    let nextCursor: string | null = null
    let slicedItems = items
    if (take !== undefined) {
      if (items.length > take) {
        nextCursor = items[take - 1].id
      }
      slicedItems = items.slice(0, take)
    }

    return {
      data: slicedItems.map((item) => ({
        ...item,
        ...shareableNoteFields(item, userId),
        // canEdit: personal fields (favorite, pin, archive, tags, folder, notes) belong to the author.
        canEdit: item.userId === userId,
        // access: what this user may do with the item's shared content.
        access:
          item.userId === userId
            ? "owner"
            : item.folderId && editableFolderIds.has(item.folderId)
              ? "editor"
              : "viewer",
      })),
      nextCursor,
      totalCount,
    }
  }

  /** One item the user may open, with what they may do with it. Used by the note editor. */
  async findOne(userId: string, id: string) {
    const bookmark = await this.prisma.bookmark.findFirst({
      where: { id, deletedAt: null, AND: [viewableBookmark(userId)] },
      include: {
        tags: true,
        folder: { select: folderSummary },
      },
    })

    if (!bookmark) {
      throw new NotFoundException("Bookmark not found")
    }
    if (bookmark.userId === userId) {
      return { ...bookmark, canEdit: true, access: "owner" as const }
    }
    const editable = bookmark.folderId
      ? await this.prisma.folder.findFirst({ where: { id: bookmark.folderId, ...editableFolder(userId) }, select: { id: true } })
      : null
    return {
      ...bookmark,
      ...shareableNoteFields(bookmark, userId),
      // Tags are personal to their author.
      tags: [],
      canEdit: false,
      access: editable ? ("editor" as const) : ("viewer" as const),
    }
  }

  async update(
    userId: string,
    id: string,
    updateBookmarkDto: UpdateBookmarkDto
  ) {
    const existing = await this.prisma.bookmark.findFirst({
      where: { id, deletedAt: null, AND: [editableBookmark(userId)] },
      select: { userId: true, type: true },
    })
    if (!existing) throw new NotFoundException("Bookmark not found")
    if (existing.userId !== userId) {
      // Editors change shared content only; personal fields stay with the author.
      const personal = (["type", "notes", "isPinned", "isFavorite", "isArchived", "folderId", "tags"] as const)
        .filter((field) => updateBookmarkDto[field] !== undefined)
      if (personal.length) {
        throw new ForbiddenException("Only the person who saved this item can change its folder, tags, notes, or personal flags")
      }
    }

    // Check folder ownership if folderId is updated
    if (updateBookmarkDto.folderId) {
      const folder = await this.prisma.folder.findFirst({
        where: { id: updateBookmarkDto.folderId, ...writableFolder(userId) },
      })
      if (!folder) {
        throw new NotFoundException("Target folder not found")
      }
    }

    // Prep tags set/connectOrCreate
    const tagConnectOrCreate = updateBookmarkDto.tags?.map((name) => {
      const formatted = name.trim().toLowerCase()
      return {
        where: { name_userId: { name: formatted, userId } },
        create: { name: formatted, userId },
      }
    })

    return this.prisma.bookmark.update({
      where: { id },
      data: {
        type: updateBookmarkDto.type,
        url: updateBookmarkDto.url,
        title: updateBookmarkDto.title,
        ...(updateBookmarkDto.title !== undefined ? { metadataTitlePending: false } : {}),
        description: updateBookmarkDto.description,
        notes: updateBookmarkDto.notes,
        ...(existing.type === BookmarkType.NOTE ? { noteRevision: { increment: 1 }, noteSaveId: null } : {}),
        ...bookmarkSortFields(updateBookmarkDto),
        isPinned: updateBookmarkDto.isPinned,
        isFavorite: updateBookmarkDto.isFavorite,
        isArchived: updateBookmarkDto.isArchived,
        folderId:
          updateBookmarkDto.folderId !== undefined
            ? updateBookmarkDto.folderId || null
            : undefined,
        tags: tagConnectOrCreate
          ? {
              set: [],
              connectOrCreate: tagConnectOrCreate,
            }
          : undefined,
      },
      include: {
        tags: true,
        folder: { select: folderSummary },
      },
    })
  }

  async remove(userId: string, id: string) {
    const existing = await this.prisma.bookmark.findFirst({
      where: { id, deletedAt: null, AND: [editableBookmark(userId)] },
      select: { id: true },
    })
    if (!existing) throw new NotFoundException("Bookmark not found")

    return this.prisma.bookmark.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    })
  }

  // ponytail: restore soft-deleted bookmark; detach orphaned folder if folder was deleted
  async restore(userId: string, id: string) {
    // Editors may restore what they trashed from a shared folder (it lands in the author's Trash).
    const bookmark = await this.prisma.bookmark.findFirst({
      where: { id, deletedAt: { not: null }, AND: [editableBookmark(userId)] },
    })

    if (!bookmark) {
      throw new NotFoundException("Bookmark not found in trash")
    }

    let folderId = bookmark.folderId
    if (folderId) {
      const folder = await this.prisma.folder.findFirst({
        where: { id: folderId, ...accessibleFolder(userId) },
      })
      if (!folder) {
        folderId = null
      }
    }

    return this.prisma.bookmark.update({
      where: { id },
      data: {
        deletedAt: null,
        folderId,
      },
      include: {
        tags: true,
        folder: { select: folderSummary },
      },
    })
  }

  // ponytail: bulk restore via updateMany
  async bulkRestore(userId: string, ids: string[]) {
    const result = await this.prisma.bookmark.updateMany({
      where: {
        id: { in: ids },
        deletedAt: { not: null },
        AND: [editableBookmark(userId)],
      },
      data: {
        deletedAt: null,
      },
    })
    return { restored: result.count }
  }

  // ponytail: bulk soft delete via updateMany
  async bulkTrash(userId: string, ids: string[]) {
    const result = await this.prisma.bookmark.updateMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        AND: [editableBookmark(userId)],
      },
      data: {
        deletedAt: new Date(),
      },
    })
    return { trashed: result.count }
  }

  // ponytail: bulk archive via updateMany
  async bulkArchive(userId: string, ids: string[], isArchived = true) {
    const result = await this.prisma.bookmark.updateMany({
      where: {
        id: { in: ids },
        userId,
        deletedAt: null,
      },
      data: {
        isArchived,
      },
    })
    return { updated: result.count }
  }

  // ponytail: bulk move folder via updateMany
  async bulkMove(userId: string, ids: string[], folderId?: string | null) {
    if (folderId) {
      const folder = await this.prisma.folder.findFirst({
        where: { id: folderId, ...writableFolder(userId) },
      })
      if (!folder) throw new NotFoundException("Folder not found")
    }
    const result = await this.prisma.bookmark.updateMany({
      where: {
        id: { in: ids },
        userId,
        deletedAt: null,
      },
      data: {
        folderId: folderId || null,
      },
    })
    return { moved: result.count }
  }

  // ponytail: bulk add tags to bookmarks
  async bulkAddTags(userId: string, ids: string[], tagNames: string[]) {
    const cleanTags = tagNames
      .map((t) => t.replace(/^#/, "").trim().toLowerCase())
      .filter(Boolean)
    if (cleanTags.length === 0 || ids.length === 0) return { updated: 0 }

    const userBookmarks = await this.prisma.bookmark.findMany({
      where: { id: { in: ids }, userId, deletedAt: null },
      select: { id: true },
    })
    const validIds = userBookmarks.map((b) => b.id)
    if (validIds.length === 0) return { updated: 0 }

    const tags = await Promise.all(
      cleanTags.map((name) =>
        this.prisma.tag.upsert({
          where: { name_userId: { name, userId } },
          create: { name, userId },
          update: {},
        })
      )
    )

    await Promise.all(
      tags.map((tag) =>
        this.prisma.tag.update({
          where: { id: tag.id },
          data: {
            bookmarks: {
              connect: validIds.map((id) => ({ id })),
            },
          },
        })
      )
    )
    return { updated: validIds.length }
  }

  // ponytail: hard delete single bookmark from database
  async permanentDelete(userId: string, id: string) {
    const bookmark = await this.prisma.bookmark.findFirst({
      where: { id, userId },
    })

    if (!bookmark) {
      throw new NotFoundException("Bookmark not found")
    }

    return this.prisma.bookmark.delete({
      where: { id },
    })
  }

  // ponytail: bulk permanent delete via deleteMany
  async bulkPermanentDelete(userId: string, ids: string[]) {
    const result = await this.prisma.bookmark.deleteMany({
      where: {
        id: { in: ids },
        userId,
      },
    })
    return { deleted: result.count }
  }

  // ponytail: empty all items in trash via deleteMany
  async emptyTrash(userId: string) {
    const result = await this.prisma.bookmark.deleteMany({
      where: {
        userId,
        deletedAt: { not: null },
      },
    })
    return { deleted: result.count }
  }

  async importBookmarks(userId: string, htmlContent: string) {
    parseBookmarkImport(htmlContent)
    return this.tasks.create(userId, "IMPORT", { html: htmlContent })
  }

  async performImport(taskId: string, userId: string, html: string, progress: (processed: number, total: number, failed: number) => Promise<void>) {
    const { entries, skipped } = parseBookmarkImport(html)
    const total = entries.filter((entry) => entry.kind === "bookmark").length
    let processed = 0
    await progress(0, total, skipped)
    try {
      for (const [index, entry] of entries.entries()) {
        const folderId = entry.parent === null ? undefined : stableTaskId(`${taskId}:folder:${entry.parent}`)
        if (entry.kind === "folder") {
          const id = stableTaskId(`${taskId}:folder:${index}`)
          await this.prisma.folder.upsert({ where: { id, userId }, create: { id, userId, name: entry.title, parentId: folderId }, update: {} })
        } else {
          // Stable operation IDs make a retry after a partial import safe for folders and links.
          await this.create(userId, { url: entry.url, title: entry.title, tags: entry.tags, folderId, source: "IMPORT", clientRequestId: stableTaskId(`${taskId}:bookmark:${index}`) })
          processed++
          if (processed % 25 === 0) await progress(processed, total, skipped)
        }
      }
    } finally {
      await progress(processed, total, skipped)
    }
  }

  async exportBookmarks(userId: string) {
    const folders = await this.prisma.folder.findMany({
      where: { userId, deletedAt: null },
      include: {
        bookmarks: {
          where: { deletedAt: null, userId },
          include: { tags: true },
          orderBy: [{ position: "asc" }, { createdAt: "desc" }],
        },
      },
      orderBy: { name: "asc" },
    })

    const rootBookmarks = await this.prisma.bookmark.findMany({
      where: { userId, folderId: null, deletedAt: null },
      include: { tags: true },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    })

    const escapeHtml = (str: string) =>
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")

    let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<!-- This is an automatically generated file. Do not edit! -->\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Cabinet Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n`

    for (const b of rootBookmarks) {
      if (!b.url) continue
      const tags = b.tags?.map((t) => t.name).join(",")
      const timestamp = Math.floor(b.createdAt.getTime() / 1000)
      html += `    <DT><A HREF="${escapeHtml(b.url)}" ADD_DATE="${timestamp}"${tags ? ` TAGS="${escapeHtml(tags)}"` : ""}>${escapeHtml(b.title || b.url)}</A>\n`
    }

    for (const f of folders) {
      const folderTime = Math.floor(f.createdAt.getTime() / 1000)
      html += `    <DT><H3 ADD_DATE="${folderTime}">${escapeHtml(f.name)}</H3>\n    <DL><p>\n`
      for (const b of f.bookmarks) {
        if (!b.url) continue
        const tags = b.tags?.map((t) => t.name).join(",")
        const timestamp = Math.floor(b.createdAt.getTime() / 1000)
        html += `        <DT><A HREF="${escapeHtml(b.url)}" ADD_DATE="${timestamp}"${tags ? ` TAGS="${escapeHtml(tags)}"` : ""}>${escapeHtml(b.title || b.url)}</A>\n`
      }
      html += `    </DL><p>\n`
    }

    html += `</DL><p>\n`
    return html
  }

  async scrapeUrl(url: string) {
    return this.metadataService.extract(url)
  }

  /** Reports whether the page may be shown in an iframe. Unknown results stay embeddable. */
  async checkEmbeddable(url: string): Promise<{ embeddable: boolean }> {
    let target = url
    for (let hop = 0; hop < 4; hop++) {
      try {
        await validatePublicUrl(target)
      } catch {
        return { embeddable: false }
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      try {
        const response = await fetch(target, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
          },
        })
        const location = response.headers.get("location")
        if (response.status >= 300 && response.status < 400 && location) {
          target = new URL(location, target).toString()
          continue
        }
        return {
          embeddable: !frameBlockedByHeaders(
            response.headers.get("x-frame-options"),
            response.headers.get("content-security-policy"),
          ),
        }
      } catch {
        return { embeddable: true }
      } finally {
        clearTimeout(timeout)
        // Only the headers matter; stop downloading the body.
        controller.abort()
      }
    }
    return { embeddable: true }
  }

  /**
   * Serves a page the browser refuses to frame directly. The response drops the site's
   * framing headers and runs under a CSP sandbox with an opaque origin; see page-proxy.ts.
   * Failures answer with a small page that tells the parent app to fall back.
   */
  async proxyPage(url: string, res: Response) {
    const fail = (status: number, message: string, reason?: PreviewErrorReason) =>
      res.status(status).set(proxiedPageHeaders()).send(proxyErrorPage(message, reason))

    let target = url
    for (let hop = 0; hop < 4; hop++) {
      try {
        await validatePublicUrl(target)
      } catch (err: any) {
        return fail(400, `This address cannot be previewed: ${err.message}`)
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      try {
        const response = await fetch(target, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.8",
          },
        })
        const location = response.headers.get("location")
        if (response.status >= 300 && response.status < 400 && location) {
          target = new URL(location, target).toString()
          continue
        }
        if (isBlockedResponse(response.status, response.headers)) {
          await response.body?.cancel().catch(() => undefined)
          const rendered = await fetchWithBrowserFallback(target, validatePublicUrl)
          if (rendered) {
            return res
              .status(200)
              .set(proxiedPageHeaders())
              .send(rewriteProxiedPage(rendered.html, rendered.finalUrl, { stripPageScripts: true }))
          }
          return fail(502, "This website blocks previews from other apps.", "blocked")
        }
        if (!response.ok) {
          return fail(502, `The website answered with status ${response.status}.`)
        }
        const contentType = response.headers.get("content-type")
        if (!isHtmlContentType(contentType)) {
          // Files such as PDFs and images are not subject to framing headers; load them directly.
          return res.redirect(302, target)
        }
        const body = await readBodyWithLimit(response, MAX_PROXIED_PAGE_BYTES)
        if (!body) return fail(502, "The page is too large to preview.")
        return res
          .status(200)
          .set(proxiedPageHeaders())
          .send(rewriteProxiedPage(decodeHtml(body, contentType), target))
      } catch (err: any) {
        const reason = err?.name === "AbortError" ? "The website took too long to respond." : "The website could not be reached."
        return fail(502, reason)
      } finally {
        clearTimeout(timeout)
      }
    }
    return fail(502, "The website redirected too many times.")
  }

  async getHealthSummary(userId: string) {
    const total = await this.prisma.bookmark.count({
      where: { userId, deletedAt: null },
    })
    const linkWhere = {
      userId,
      type: BookmarkType.BOOKMARK,
      url: { not: null },
      deletedAt: null,
    }
    const broken = await this.prisma.bookmark.count({
      where: { ...linkWhere, status: "BROKEN" },
    })
    const redirected = await this.prisma.bookmark.count({
      where: { ...linkWhere, status: "REDIRECTED" },
    })
    const favorites = await this.prisma.bookmark.count({
      where: { userId, isFavorite: true, deletedAt: null },
    })
    const archived = await this.prisma.bookmark.count({
      where: { userId, isArchived: true, deletedAt: null },
    })
    const trash = await this.prisma.bookmark.count({
      where: { userId, deletedAt: { not: null } },
    })

    const duplicatesGrouped = await this.prisma.bookmark.groupBy({
      by: ["url"],
      where: duplicateCandidates(userId),
      _count: { url: true },
      having: {
        url: {
          _count: {
            gt: 1,
          },
        },
      },
    })
    const duplicates = duplicatesGrouped.length

    return { total, broken, redirected, favorites, archived, duplicates, trash }
  }

  async getDuplicates(userId: string) {
    const duplicatesGrouped = await this.prisma.bookmark.groupBy({
      by: ["url"],
      where: duplicateCandidates(userId),
      _count: { url: true },
      having: {
        url: {
          _count: { gt: 1 },
        },
      },
    })

    const urls = duplicatesGrouped.map((g) => g.url)
    const bookmarks = await this.prisma.bookmark.findMany({
      where: {
        ...duplicateCandidates(userId),
        url: { in: urls },
      },
      include: {
        tags: true,
        folder: { select: folderSummary },
      },
      orderBy: { createdAt: "desc" },
    })

    return urls.map((url) => ({
      url,
      bookmarks: bookmarks.filter((b) => b.url === url),
    }))
  }

  async cleanDuplicates(userId: string) {
    const duplicatesGrouped = await this.prisma.bookmark.groupBy({
      by: ["url"],
      where: { userId, deletedAt: null },
      _count: { url: true },
      having: {
        url: {
          _count: { gt: 1 },
        },
      },
    })

    const urls = duplicatesGrouped.map((g) => g.url)
    if (urls.length === 0) {
      return { deleted: 0 }
    }

    const allDuplicates = await this.prisma.bookmark.findMany({
      where: { userId, url: { in: urls }, deletedAt: null },
      orderBy: { createdAt: "asc" },
    })

    const seenUrls = new Set<string>()
    const idsToDelete: string[] = []

    for (const item of allDuplicates) {
      if (seenUrls.has(item.url)) {
        idsToDelete.push(item.id)
      } else {
        seenUrls.add(item.url)
      }
    }

    if (idsToDelete.length > 0) {
      await this.prisma.bookmark.updateMany({
        where: { id: { in: idsToDelete } },
        data: { deletedAt: new Date() },
      })
    }

    return { deleted: idsToDelete.length }
  }

  async enrichMissingMetadata(userId?: string) {
    const bookmarks = await this.prisma.bookmark.findMany({
      where: { ...(userId ? { userId } : {}), deletedAt: null, type: BookmarkType.BOOKMARK, url: { not: null }, metadataStatus: { in: [MetadataStatus.PENDING, MetadataStatus.FAILED] } },
      select: { id: true, url: true }, take: 100, orderBy: { createdAt: "desc" },
    })
    let queued = 0
    for (const bookmark of bookmarks) if (await this.metadataQueue.enqueue(bookmark, true)) queued++
    return { queued, totalFound: bookmarks.length }
  }

  async triggerHealthCheck(userId: string) {
    return this.tasks.create(userId, "LINK_CHECK")
  }

  async reorder(userId: string, ids: string[]) {
    await this.prisma.$transaction(async (tx) => {
      const bookmarks = await tx.bookmark.findMany({
        where: { userId, deletedAt: null },
        select: { id: true, isPinned: true },
        orderBy: [{ position: "asc" }, { createdAt: "desc" }, { id: "asc" }],
      })
      const moved = new Set(ids)
      const owned = new Set(bookmarks.filter((bookmark) => !bookmark.isPinned).map((bookmark) => bookmark.id))
      if (moved.size !== ids.length || ids.some((id) => !owned.has(id))) {
        throw new BadRequestException("Invalid bookmark order")
      }

      // Keep filtered/unloaded bookmarks in their slots, not interleaved at position 0.
      // ponytail: renumber the library; use sparse ranks if library size makes this costly.
      let next = 0
      await Promise.all(bookmarks.map((bookmark, position) =>
        bookmark.isPinned ? undefined : tx.bookmark.updateMany({
          where: { id: moved.has(bookmark.id) ? ids[next++] : bookmark.id, userId, isPinned: false },
          data: { position },
        })
      ))
    })
    return { success: true }
  }

  async proxyImage(imageUrl: string, res: Response) {
    let parsedUrl: URL
    try {
      parsedUrl = await validatePublicUrl(imageUrl)
    } catch (err: any) {
      return res
        .status(400)
        .send(`Invalid or disallowed image URL: ${err.message}`)
    }

    try {
      const response = await axios.get(parsedUrl.href, {
        responseType: "stream",
        timeout: 10000,
        headers: {
          // Reddit's share endpoint returns a generic logo to desktop browsers.
          "User-Agent":
            parsedUrl.hostname === "share.redd.it"
              ? CRAWLER_USER_AGENTS.WHATSAPP
              : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          Referer: parsedUrl.origin,
        },
        maxRedirects: 5,
        beforeRedirect: async (options) => {
          await validatePublicUrl(options.href)
        },
        validateStatus: (status) => status >= 200 && status < 400,
      })

      const contentType = response.headers["content-type"]
        ? String(response.headers["content-type"])
        : "image/jpeg"
      const contentLength = response.headers["content-length"]
        ? String(response.headers["content-length"])
        : undefined

      res.setHeader("Content-Type", contentType)
      if (contentLength) {
        res.setHeader("Content-Length", contentLength)
      }
      res.setHeader(
        "Cache-Control",
        "public, max-age=86400, s-maxage=86400, immutable"
      )
      res.setHeader("Access-Control-Allow-Origin", "*")

      response.data.pipe(res)
    } catch (error: any) {
      return res.status(502).send(`Failed to proxy image: ${error.message}`)
    }
  }

  async extractMedia(url: string) {
    return this.cabinetMediaService.extract(url)
  }

  async downloadMedia(dto: DownloadMediaDto, res: Response) {
    return this.cabinetMediaService.download(dto, res)
  }
}

/** Collects a response body, or returns null once it exceeds the byte limit. */
async function readBodyWithLimit(response: globalThis.Response, limit: number): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

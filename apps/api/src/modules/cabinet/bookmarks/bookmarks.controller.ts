import {
  Controller,
  HttpCode,
  Get,
  Post,
  Body,
  Patch,
  Put,
  ParseUUIDPipe,
  ParseEnumPipe,
  Param,
  Delete,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiQuery, ApiCookieAuth } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/guards/auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { BookmarksService } from './bookmarks.service';
import { BookmarkSort } from './bookmark-order';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';
import { UpdateBookmarkDto } from './dto/update-bookmark.dto';
import { ImportBookmarksDto } from './dto/import-bookmarks.dto';
import { ReorderBookmarksDto } from './dto/reorder-bookmarks.dto';
import { DownloadMediaDto } from '@/modules/cabinet/dto/download-media.dto';
import { SaveNoteDto } from './dto/save-note.dto';
import { SaveDrawingDto } from './dto/save-drawing.dto';
import { SavedSearchDto } from './dto/saved-search.dto';
import {
  BulkActionDto,
  BulkArchiveDto,
  BulkMoveDto,
  BulkTagsDto,
} from './dto/bulk-action.dto';
import { BookmarkType, BookmarkContentType } from '@prisma/client';

@ApiTags('bookmarks')
@ApiCookieAuth()
@Controller('v1/bookmarks')
@UseGuards(AuthGuard)
export class BookmarksController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  @Get('saved-searches')
  async savedSearches(@CurrentUser() user: any) {
    return this.bookmarksService.savedSearches(user.id);
  }

  @Post('saved-searches')
  async saveSearch(@CurrentUser() user: any, @Body() dto: SavedSearchDto) {
    return this.bookmarksService.saveSearch(user.id, dto);
  }

  @Delete('saved-searches/:id')
  async deleteSearch(@CurrentUser() user: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.bookmarksService.deleteSearch(user.id, id);
  }

  @Put(':id/note')
  @ApiOperation({ summary: 'Create or autosave a note using a stable ID' })
  async saveNote(
    @CurrentUser() user: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SaveNoteDto,
  ) {
    return this.bookmarksService.saveNote(user.id, id, dto);
  }

  @Put(':id/drawing')
  @ApiOperation({ summary: 'Create or autosave a drawing using a stable ID' })
  async saveDrawing(
    @CurrentUser() user: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SaveDrawingDto,
  ) {
    return this.bookmarksService.saveDrawing(user.id, id, dto);
  }

  @Public()
  @Get('proxy-image')
  @ApiOperation({ summary: 'Proxy external image to bypass CORS and hotlink protection' })
  @ApiQuery({ name: 'url', required: true })
  async proxyImage(@Query('url') url: string, @Res() res: Response) {
    return this.bookmarksService.proxyImage(url, res);
  }

  @Get('scrape')
  @ApiOperation({ summary: 'Scrape metadata and generate tags for a URL' })
  @ApiQuery({ name: 'url', required: true })
  async scrape(@Query('url') url: string) {
    return this.bookmarksService.scrapeUrl(url);
  }

  @Get('embeddable')
  @ApiOperation({ summary: 'Check whether a website allows being shown in an iframe' })
  @ApiQuery({ name: 'url', required: true })
  async embeddable(@Query('url') url: string) {
    return this.bookmarksService.checkEmbeddable(url);
  }

  @Get('proxy-page')
  @ApiOperation({ summary: 'Serve a page that forbids framing, rewritten for a sandboxed preview iframe' })
  @ApiQuery({ name: 'url', required: true })
  async proxyPage(@Query('url') url: string, @Res() res: Response) {
    return this.bookmarksService.proxyPage(url, res);
  }

  @Get('media/extract')
  @ApiOperation({ summary: 'Extract downloadable video/audio formats using yt-dlp' })
  @ApiQuery({ name: 'url', required: true })
  async extractMedia(@Query('url') url: string) {
    return this.bookmarksService.extractMedia(url);
  }

  @Post('media/download')
  @ApiOperation({ summary: 'Stream download video or audio file via yt-dlp' })
  async downloadMedia(
    @CurrentUser() user: any,
    @Body() dto: DownloadMediaDto,
    @Res() res: Response,
  ) {
    return this.bookmarksService.downloadMedia(dto, res);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new bookmark (extracts title/metadata if omitted)' })
  async create(
    @CurrentUser() user: any,
    @Body() createBookmarkDto: CreateBookmarkDto,
  ) {
    return this.bookmarksService.create(user.id, createBookmarkDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get bookmarks with optional filtering' })
  @ApiQuery({ name: 'folderId', required: false })
  @ApiQuery({ name: 'type', required: false, enum: BookmarkType })
  @ApiQuery({ name: 'contentType', required: false })
  @ApiQuery({ name: 'isFavorite', required: false, type: Boolean })
  @ApiQuery({ name: 'isArchived', required: false, type: Boolean })
  @ApiQuery({ name: 'isTrash', required: false, type: Boolean })
  @ApiQuery({ name: 'tag', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'domain', required: false })
  @ApiQuery({ name: 'addedAfter', required: false, description: 'Inclusive UTC date (YYYY-MM-DD)' })
  @ApiQuery({ name: 'addedBefore', required: false, description: 'Inclusive UTC date (YYYY-MM-DD)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sort', required: false, enum: BookmarkSort, default: BookmarkSort.Custom })
  @ApiQuery({ name: 'status', required: false })
  async findAll(
    @CurrentUser() user: any,
    @Query('folderId') folderId?: string,
    @Query('type') type?: BookmarkType,
    @Query('contentType') contentType?: BookmarkContentType,
    @Query('isFavorite') isFavorite?: string,
    @Query('isArchived') isArchived?: string,
    @Query('isTrash') isTrash?: string,
    @Query('tag') tag?: string,
    @Query('search') search?: string,
    @Query('domain') domain?: string,
    @Query('addedAfter') addedAfter?: string,
    @Query('addedBefore') addedBefore?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('sort', new ParseEnumPipe(BookmarkSort, { optional: true })) sort?: BookmarkSort,
  ) {
    const parseBool = (val?: string) => {
      if (val === 'true') return true;
      if (val === 'false') return false;
      return undefined;
    };
    return this.bookmarksService.findAll(user.id, {
      folderId,
      type,
      contentType,
      isFavorite: parseBool(isFavorite),
      isArchived: parseBool(isArchived),
      isTrash: parseBool(isTrash),
      tag,
      search,
      domain,
      addedAfter,
      addedBefore,
      cursor,
      limit: limit === undefined ? undefined : Number(limit),
      status,
      sort,
    });
  }

  @Post('import')
  @HttpCode(202)
  @ApiOperation({ summary: 'Queue an HTML bookmark import and return its persistent task status' })
  async import(
    @CurrentUser() user: any,
    @Body() importBookmarksDto: ImportBookmarksDto,
  ) {
    return this.bookmarksService.importBookmarks(user.id, importBookmarksDto.htmlContent);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export user bookmarks in standard Netscape HTML format' })
  async exportBookmarks(@CurrentUser() user: any, @Res() res: Response) {
    const html = await this.bookmarksService.exportBookmarks(user.id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="cabinet-bookmarks.html"',
    );
    return res.send(html);
  }

  @Get('health')
  @ApiOperation({ summary: 'Get bookmark health status count summary' })
  async getHealthSummary(@CurrentUser() user: any) {
    return this.bookmarksService.getHealthSummary(user.id);
  }

  @Get('rediscover')
  @ApiOperation({ summary: 'Get a shuffled selection of older saved items to revisit' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async rediscover(@CurrentUser() user: any, @Query('limit') limit?: string) {
    return this.bookmarksService.rediscover(user.id, limit === undefined ? undefined : Number(limit));
  }

  @Get('duplicates')
  @ApiOperation({ summary: 'Get groups of duplicate bookmarks' })
  async getDuplicates(@CurrentUser() user: any) {
    return this.bookmarksService.getDuplicates(user.id);
  }

  @Delete('duplicates/clean')
  @ApiOperation({ summary: 'Auto-clean duplicate bookmarks' })
  async cleanDuplicates(@CurrentUser() user: any) {
    return this.bookmarksService.cleanDuplicates(user.id);
  }

  @Post('health/check')
  @HttpCode(202)
  @ApiOperation({ summary: 'Trigger manual scan of bookmark links status' })
  async triggerHealthCheck(@CurrentUser() user: any) {
    return this.bookmarksService.triggerHealthCheck(user.id);
  }

  @Post('enrich-missing')
  @ApiOperation({ summary: 'Queue background enrichment for bookmarks with missing images/metadata' })
  async enrichMissing(@CurrentUser() user: any) {
    return this.bookmarksService.enrichMissingMetadata(user.id);
  }

  @Patch('reorder')
  @ApiOperation({ summary: 'Reorder bookmarks position' })
  async reorder(
    @CurrentUser() user: any,
    @Body() reorderDto: ReorderBookmarksDto,
  ) {
    return this.bookmarksService.reorder(user.id, reorderDto.ids);
  }

  @Post('bulk/restore')
  @ApiOperation({ summary: 'Restore multiple soft-deleted bookmarks' })
  async bulkRestore(
    @CurrentUser() user: any,
    @Body() body: { ids: string[] },
  ) {
    return this.bookmarksService.bulkRestore(user.id, body.ids || []);
  }

  @Post('bulk/trash')
  @ApiOperation({ summary: 'Move multiple bookmarks to trash' })
  async bulkTrash(
    @CurrentUser() user: any,
    @Body() dto: BulkActionDto,
  ) {
    return this.bookmarksService.bulkTrash(user.id, dto.ids || []);
  }

  @Post('bulk/archive')
  @ApiOperation({ summary: 'Archive or unarchive multiple bookmarks' })
  async bulkArchive(
    @CurrentUser() user: any,
    @Body() dto: BulkArchiveDto,
  ) {
    return this.bookmarksService.bulkArchive(
      user.id,
      dto.ids || [],
      dto.isArchived ?? true
    );
  }

  @Post('bulk/move')
  @ApiOperation({ summary: 'Move multiple bookmarks to a folder' })
  async bulkMove(
    @CurrentUser() user: any,
    @Body() dto: BulkMoveDto,
  ) {
    return this.bookmarksService.bulkMove(
      user.id,
      dto.ids || [],
      dto.folderId
    );
  }

  @Post('bulk/tags')
  @ApiOperation({ summary: 'Add tags to multiple bookmarks' })
  async bulkAddTags(
    @CurrentUser() user: any,
    @Body() dto: BulkTagsDto,
  ) {
    return this.bookmarksService.bulkAddTags(
      user.id,
      dto.ids || [],
      dto.tags || []
    );
  }

  @Post('bulk/permanent-delete')
  @ApiOperation({ summary: 'Permanently delete multiple bookmarks' })
  async bulkPermanentDelete(
    @CurrentUser() user: any,
    @Body() body: { ids: string[] },
  ) {
    return this.bookmarksService.bulkPermanentDelete(user.id, body.ids || []);
  }

  @Delete('trash/empty')
  @ApiOperation({ summary: 'Permanently delete all bookmarks in trash' })
  async emptyTrash(@CurrentUser() user: any) {
    return this.bookmarksService.emptyTrash(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get bookmark details by ID' })
  async findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.bookmarksService.findOne(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a bookmark by ID' })
  async update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() updateBookmarkDto: UpdateBookmarkDto,
  ) {
    return this.bookmarksService.update(user.id, id, updateBookmarkDto);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Restore a soft-deleted bookmark' })
  async restore(@CurrentUser() user: any, @Param('id') id: string) {
    return this.bookmarksService.restore(user.id, id);
  }

  @Post(':id/enrichment/refresh')
  @HttpCode(202)
  @ApiOperation({ summary: 'Refresh enrichment metadata for a bookmark' })
  async refreshEnrichment(@CurrentUser() user: any, @Param('id') id: string) {
    return this.bookmarksService.refreshEnrichment(user.id, id);
  }

  @Delete(':id/permanent')
  @ApiOperation({ summary: 'Permanently delete a bookmark by ID' })
  async permanentDelete(@CurrentUser() user: any, @Param('id') id: string) {
    return this.bookmarksService.permanentDelete(user.id, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a bookmark by ID' })
  async remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.bookmarksService.remove(user.id, id);
  }
}

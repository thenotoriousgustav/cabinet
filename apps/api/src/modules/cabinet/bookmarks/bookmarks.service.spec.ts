import { Test, TestingModule } from '@nestjs/testing';
import { BookmarksService } from './bookmarks.service';
import { BookmarkSort, bookmarkOrderBy, bookmarkSortFields } from './bookmark-order';
import { UpdateBookmarkDto } from './dto/update-bookmark.dto';
import { validate } from 'class-validator';
import { PrismaService } from '@/prisma/prisma.service';
import { MetadataService } from '@/modules/cabinet/services/metadata.service';
import { LinkCheckerService } from '@/modules/cabinet/services/link-checker.service';
import { CabinetMediaService } from '@/modules/cabinet/services/cabinet-media.service';
import { MetadataQueueService } from '../services/metadata-queue.service';
import { BackgroundTasksService } from '../services/background-tasks.service';
import axios from 'axios';
import type { Response } from 'express';
import { CRAWLER_USER_AGENTS } from '@/modules/cabinet/providers/metadata/metadata-provider.interface';

describe('BookmarksService - Trash Functionality', () => {
  let service: BookmarksService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      bookmark: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      folder: {
        findFirst: jest.fn(),
        // findAll looks up folders the user can edit; none by default.
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookmarksService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetadataService, useValue: { extract: jest.fn().mockResolvedValue({}) } },
        {
          provide: CabinetMediaService,
          useValue: {
            isVideoUrl: jest.fn().mockReturnValue(false),
            extract: jest.fn(),
            download: jest.fn(),
          },
        },
        { provide: LinkCheckerService, useValue: { runScan: jest.fn() } },
        { provide: MetadataQueueService, useValue: { enqueue: jest.fn().mockResolvedValue(true) } },
        { provide: BackgroundTasksService, useValue: { create: jest.fn().mockResolvedValue({ id: 'task-1', status: 'PENDING' }) } },
      ],
    }).compile();

    service = module.get<BookmarksService>(BookmarksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('folder collaboration', () => {
    it('requires current folder access, shares notes, and redacts personal notes on other people links', async () => {
      prisma.folder.findFirst.mockResolvedValue({ id: 'shared' });
      prisma.bookmark.findMany.mockResolvedValue([
        { id: 'own', userId: 'member', type: 'BOOKMARK', notes: 'mine' },
        { id: 'foreign', userId: 'owner', type: 'BOOKMARK', notes: 'private', noteDocument: { secret: true } },
        { id: 'their-note', userId: 'owner', type: 'NOTE', notes: 'Agenda', noteDocument: { type: 'doc', content: [] } },
      ]);
      prisma.bookmark.count.mockResolvedValue(3);
      const result = await service.findAll('member', { folderId: 'shared', search: 'hello' });
      expect(prisma.folder.findFirst).toHaveBeenCalledWith({ where: {
        id: 'shared', deletedAt: null, OR: [{ userId: 'member' }, { members: { some: { userId: 'member' } } }],
      }, select: { id: true } });
      const query = prisma.bookmark.findMany.mock.calls[0][0];
      expect(query.where.userId).toBeUndefined();
      expect(query.where.AND).toBeUndefined(); // Links and notes in the folder are both visible.
      expect(query.where.id).toEqual({ in: [] }); // Ranked IDs never replace the access predicate.
      expect(prisma.$queryRaw.mock.calls[0][0].sql).toContain('CASE WHEN b."userId"');
      expect(query.include.folder.select).toEqual({ id: true, name: true, userId: true, parentId: true });
      expect(result.data[0]).toMatchObject({ canEdit: true, notes: 'mine' });
      expect(result.data[1]).toMatchObject({ canEdit: false, notes: null, noteDocument: null });
      expect(result.data[2]).toMatchObject({ canEdit: false, notes: 'Agenda', noteDocument: { type: 'doc', content: [] } });
    });

    it('rejects revoked memberships and keeps personal library and trash scoped to the contributor', async () => {
      prisma.folder.findFirst.mockResolvedValue(null);
      await expect(service.findAll('outsider', { folderId: 'private' })).rejects.toThrow('Folder not found');
      expect(prisma.bookmark.findMany).not.toHaveBeenCalled();
      prisma.bookmark.findMany.mockResolvedValue([]);
      await service.findAll('member', {});
      expect(prisma.bookmark.findMany.mock.calls[0][0].where.userId).toBe('member');
      prisma.folder.findFirst.mockResolvedValue({ id: 'shared' });
      await service.findAll('member', { folderId: 'shared', isTrash: true });
      expect(prisma.bookmark.findMany.mock.calls[1][0].where.userId).toBe('member');
    });

    const editableBy = (userId: string) => ({ OR: [{ userId }, { folder: { is: { deletedAt: null, OR: [{ userId }, { members: { some: { userId, role: 'EDITOR' } } }] } } }] });

    it('limits edits and trash to own items or links in folders the user owns or edits', async () => {
      prisma.bookmark.findFirst.mockResolvedValue(null);
      await expect(service.update('member', 'foreign', { title: 'overwrite' })).rejects.toThrow('Bookmark not found');
      await expect(service.remove('member', 'foreign')).rejects.toThrow('Bookmark not found');
      expect(prisma.bookmark.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'foreign', deletedAt: null, AND: [editableBy('member')] },
      }));
      expect(prisma.bookmark.update).not.toHaveBeenCalled();
      prisma.bookmark.updateMany.mockResolvedValue({ count: 0 });
      await service.bulkTrash('member', ['foreign']);
      expect(prisma.bookmark.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: { in: ['foreign'] }, deletedAt: null, AND: [editableBy('member')] },
      }));
    });

    it('lets editors change shared content but never the author personal fields', async () => {
      prisma.bookmark.findFirst.mockResolvedValue({ userId: 'owner' });
      prisma.bookmark.update.mockResolvedValue({ id: 'foreign' });
      await service.update('editor', 'foreign', { title: 'Better title', description: 'Clearer', url: 'https://example.com' });
      expect(prisma.bookmark.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'foreign' }, data: expect.objectContaining({ title: 'Better title' }),
      }));
      prisma.bookmark.update.mockClear();
      for (const patch of [{ isFavorite: true }, { isPinned: true }, { isArchived: true }, { tags: ['x'] }, { folderId: null }, { notes: 'x' }]) {
        await expect(service.update('editor', 'foreign', patch as any)).rejects.toThrow('Only the person who saved this item');
      }
      expect(prisma.bookmark.update).not.toHaveBeenCalled();
    });

    it('marks items editable only in folders the user owns or edits', async () => {
      prisma.folder.findMany.mockResolvedValue([{ id: 'edited' }]);
      prisma.bookmark.findMany.mockResolvedValue([
        { id: 'mine', userId: 'me', type: 'BOOKMARK', folderId: 'viewed' },
        { id: 'theirs-edited', userId: 'other', type: 'BOOKMARK', folderId: 'edited' },
        { id: 'theirs-viewed', userId: 'other', type: 'BOOKMARK', folderId: 'viewed' },
        { id: 'their-note', userId: 'other', type: 'NOTE', folderId: 'edited' },
      ]);
      prisma.bookmark.count.mockResolvedValue(4);
      const result = await service.findAll('me', {});
      expect(prisma.folder.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null, OR: [{ userId: 'me' }, { members: { some: { userId: 'me', role: 'EDITOR' } } }] },
        select: { id: true },
      });
      expect(result.data.map((item: any) => [item.id, item.access, item.canEdit])).toEqual([
        ['mine', 'owner', true],
        ['theirs-edited', 'editor', false],
        ['theirs-viewed', 'viewer', false],
        ['their-note', 'editor', false],
      ]);
    });

    it('opens shared notes with the reader access, never the author tags', async () => {
      prisma.bookmark.findFirst.mockResolvedValue({ id: 'n', userId: 'owner', type: 'NOTE', folderId: 'f', notes: 'Agenda', noteDocument: { type: 'doc', content: [] }, tags: [{ name: 'private' }] });
      prisma.folder.findFirst.mockResolvedValueOnce({ id: 'f' });
      await expect(service.findOne('editor', 'n')).resolves.toMatchObject({ access: 'editor', canEdit: false, notes: 'Agenda', tags: [] });
      prisma.folder.findFirst.mockResolvedValueOnce(null);
      await expect(service.findOne('viewer', 'n')).resolves.toMatchObject({ access: 'viewer', canEdit: false });
      expect(prisma.bookmark.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
        where: { id: 'n', deletedAt: null, AND: [{ OR: [{ userId: 'viewer' }, { folder: { is: { deletedAt: null, OR: [{ userId: 'viewer' }, { members: { some: { userId: 'viewer' } } }] } } }] }] },
      }));
    });

    it('lets editors save a shared note content but not its folder or tags', async () => {
      const doc = { type: 'doc', content: [] };
      prisma.bookmark.findFirst.mockResolvedValue({ id: 'n', userId: 'owner', type: 'NOTE', folderId: 'f', deletedAt: null });
      prisma.folder.findFirst.mockResolvedValue({ id: 'f' });
      prisma.bookmark.update.mockResolvedValue({ id: 'n' });
      await service.saveNote('editor', 'n', { title: 'Agenda', notes: 'x', noteDocument: doc, folderId: null, tags: ['mine'] } as any);
      expect(prisma.bookmark.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'n' },
        data: { title: 'Agenda', sortTitle: 'agenda', notes: 'x', noteDocument: doc, noteRevision: { increment: 1 }, noteSaveId: null },
      }));
      prisma.folder.findFirst.mockResolvedValue(null);
      prisma.bookmark.update.mockClear();
      await expect(service.saveNote('viewer', 'n', { title: 'x', noteDocument: doc } as any)).rejects.toThrow('Note not found');
      expect(prisma.bookmark.update).not.toHaveBeenCalled();
    });

    describe('drawings', () => {
      const scene = { elements: [{ id: 'e1', type: 'rectangle' }], appState: { viewBackgroundColor: '#fff' }, files: {} };

      it('creates a drawing under its client id and keeps the scene out of the response', async () => {
        prisma.bookmark.findFirst.mockResolvedValue(null);
        prisma.bookmark.upsert.mockResolvedValue({ id: 'd' });
        await service.saveDrawing('me', 'd', { title: ' Flow ', scene, preview: 'data:image/webp;base64,AAAA', folderId: null } as any);
        expect(prisma.bookmark.upsert).toHaveBeenCalledWith(expect.objectContaining({
          where: { id: 'd', userId: 'me', type: 'DRAWING', deletedAt: null },
          create: expect.objectContaining({ id: 'd', userId: 'me', type: 'DRAWING', title: 'Flow', drawing: scene, imageUrl: 'data:image/webp;base64,AAAA', folderId: null }),
          omit: { drawing: true },
        }));
      });

      it('lets editors save the scene and title only, and rejects viewers', async () => {
        prisma.bookmark.findFirst.mockResolvedValue({ userId: 'owner', type: 'DRAWING', deletedAt: null, folderId: 'f' });
        prisma.folder.findFirst.mockResolvedValue({ id: 'f' });
        prisma.bookmark.update.mockResolvedValue({ id: 'd' });
        await service.saveDrawing('editor', 'd', { title: 'Flow', scene, folderId: null, tags: ['x'] } as any);
        expect(prisma.bookmark.update).toHaveBeenCalledWith(expect.objectContaining({
          where: { id: 'd' },
          data: { title: 'Flow', sortTitle: 'flow', drawing: scene },
        }));
        prisma.folder.findFirst.mockResolvedValue(null);
        prisma.bookmark.update.mockClear();
        await expect(service.saveDrawing('viewer', 'd', { scene } as any)).rejects.toThrow('Drawing not found');
        expect(prisma.bookmark.update).not.toHaveBeenCalled();
      });

      it('rejects a scene without elements and items that are not drawings', async () => {
        await expect(service.saveDrawing('me', 'd', { scene: {} } as any)).rejects.toThrow('Invalid drawing');
        prisma.bookmark.findFirst.mockResolvedValue({ userId: 'me', type: 'NOTE', deletedAt: null });
        await expect(service.saveDrawing('me', 'n', { scene } as any)).rejects.toThrow('Drawing not found');
      });

      it('keeps scenes out of library lists', async () => {
        prisma.bookmark.findMany.mockResolvedValue([]);
        prisma.bookmark.count.mockResolvedValue(0);
        await service.findAll('me', {});
        expect(prisma.bookmark.findMany.mock.calls[0][0].omit).toEqual({ drawing: true });
      });
    });

    it('refuses to add items to folders shared as view only', async () => {
      prisma.folder.findFirst.mockResolvedValue(null);
      await expect(service.create('viewer', { url: 'https://example.com', folderId: 'shared' } as any)).rejects.toThrow('Target folder not found');
      expect(prisma.folder.findFirst).toHaveBeenCalledWith({
        where: { id: 'shared', deletedAt: null, OR: [{ userId: 'viewer' }, { members: { some: { userId: 'viewer', role: { in: ['CONTRIBUTOR', 'EDITOR'] } } } }] },
      });
      expect(prisma.bookmark.create).not.toHaveBeenCalled();
    });

    it('lets members move their own bookmarks into a shared folder but not an inaccessible folder', async () => {
      prisma.folder.findFirst.mockResolvedValue({ id: 'shared' });
      prisma.bookmark.updateMany.mockResolvedValue({ count: 1 });
      await service.bulkMove('member', ['own'], 'shared');
      expect(prisma.bookmark.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['own'] }, userId: 'member', deletedAt: null }, data: { folderId: 'shared' } });
      prisma.folder.findFirst.mockResolvedValue(null);
      await expect(service.bulkMove('member', ['own'], 'private')).rejects.toThrow('Folder not found');
    });
  });

  describe('bookmark ordering', () => {
    beforeEach(() => {
      prisma.$transaction = jest.fn((run) => run(prisma));
      // Includes unloaded/filtered items; legacy positions can all be zero.
      prisma.bookmark.findMany.mockResolvedValue([
        { id: 'a' }, { id: 'hidden' }, { id: 'b' }, { id: 'unloaded' },
      ]);
    });

    it('reorders visible slots without letting unseen bookmarks jump ahead', async () => {
      await service.reorder('user-1', ['b', 'a']);
      expect(prisma.bookmark.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'user-1', deletedAt: null },
      }));
      expect(prisma.bookmark.updateMany.mock.calls.map(([args]) => args)).toEqual(
        ['b', 'hidden', 'a', 'unloaded'].map((id, position) => ({
          where: { id, userId: 'user-1', isPinned: false }, data: { position },
        })),
      );
    });

    it('keeps pinned slots locked while reordering unpinned bookmarks', async () => {
      prisma.bookmark.findMany.mockResolvedValue([{ id: 'a' }, { id: 'pin', isPinned: true }, { id: 'b' }]);
      await service.reorder('user-1', ['b', 'a']);
      expect(prisma.bookmark.updateMany.mock.calls.map(([args]) => [args.where.id, args.data.position])).toEqual([['b', 0], ['a', 2]]);
      prisma.bookmark.updateMany.mockClear();
      await expect(service.reorder('user-1', ['pin', 'a'])).rejects.toThrow('Invalid bookmark order');
      expect(prisma.bookmark.updateMany).not.toHaveBeenCalled();
    });

    it.each([['a', 'a'], ['a', 'another-users-bookmark']])(
      'rejects duplicate or unowned IDs: %s, %s', async (...ids) => {
        await expect(service.reorder('user-1', ids)).rejects.toThrow('Invalid bookmark order');
        expect(prisma.bookmark.updateMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('smart sorting and pinning', () => {
    it.each(Object.values(BookmarkSort))('sorts %s in the database before paginating, with pinned items first', async (sort) => {
      prisma.folder.findFirst.mockResolvedValue({ id: 'folder-1' });
      prisma.bookmark.findMany.mockResolvedValue(['one', 'two', 'three'].map((id) => ({ id, userId: 'user-1' })));
      prisma.bookmark.count.mockResolvedValue(3);
      const result = await service.findAll('user-1', { sort, limit: 2, folderId: 'folder-1' });
      expect(prisma.bookmark.findMany).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: bookmarkOrderBy(sort), take: 3, where: expect.objectContaining({ folderId: 'folder-1' }),
      }));
      expect(bookmarkOrderBy(sort)[0]).toEqual({ isPinned: 'desc' });
      expect(bookmarkOrderBy(sort).at(-1)).toEqual({ id: 'asc' });
      expect(result).toEqual({ data: ['one', 'two'].map((id) => ({ id, userId: 'user-1', canEdit: true, access: 'owner' })), nextCursor: 'two', totalCount: 3 });
      prisma.bookmark.count.mockClear();
      await service.findAll('user-1', { sort, limit: 2, cursor: 'two' });
      expect(prisma.bookmark.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: bookmarkOrderBy(sort), cursor: { id: 'two' }, skip: 1 }));
      expect(prisma.bookmark.count).not.toHaveBeenCalled();
    });

    it('accepts only boolean pin values at the API boundary', async () => {
      for (const isPinned of ['true', 'false', 1, null]) {
        const errors = await validate(Object.assign(new UpdateBookmarkDto(), { isPinned }));
        expect(errors.some((error) => error.property === 'isPinned')).toBe(true);
      }
      for (const isPinned of [true, false, undefined]) {
        expect(await validate(Object.assign(new UpdateBookmarkDto(), { isPinned }))).toHaveLength(0);
      }
    });

    it('rejects unknown sorting and invalid page sizes', async () => {
      await expect(service.findAll('u', { sort: 'invalid' as BookmarkSort })).rejects.toThrow('Invalid bookmark sort');
      for (const limit of [0, -1, 1.5, NaN, 101]) {
        await expect(service.findAll('u', { limit })).rejects.toThrow('Limit must be');
      }
      expect(prisma.bookmark.findMany).not.toHaveBeenCalled();
    });

    it('persists pin/unpin only for an active bookmark owned by the user', async () => {
      prisma.bookmark.findFirst.mockResolvedValue({ id: 'a', userId: 'user-1' });
      for (const isPinned of [true, false]) {
        await service.update('user-1', 'a', { isPinned });
        expect(prisma.bookmark.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ isPinned }) }));
      }
      prisma.bookmark.findFirst.mockResolvedValue(null);
      prisma.bookmark.update.mockClear();
      await expect(service.update('user-2', 'a', { isPinned: true })).rejects.toThrow('Bookmark not found');
      expect(prisma.bookmark.update).not.toHaveBeenCalled();
    });

    it('normalizes title and hostname without including paths, credentials, www or port', () => {
      expect(bookmarkSortFields({ title: 'Zebra API', url: 'https://user:pass@WWW.Example.com:443/a?q=b' }))
        .toEqual({ sortTitle: 'zebra api', sortDomain: 'example.com' });
      expect(bookmarkSortFields({ title: 'Note', url: null })).toEqual({ sortTitle: 'note', sortDomain: null });
      expect(bookmarkSortFields({})).toEqual({ sortTitle: undefined, sortDomain: undefined });
    });
  });

  describe('global library search', () => {
    it('searches accessible shared links and owned notes without exposing other contributors private notes', async () => {
      prisma.bookmark.findMany.mockResolvedValue([{ id: 'shared', userId: 'another', type: 'BOOKMARK', notes: 'private', noteDocument: { secret: true } }]);
      prisma.bookmark.count.mockResolvedValue(1);
      const result = await service.findAll('viewer', { search: 'reference', limit: 20 });
      const where = prisma.bookmark.findMany.mock.calls[0][0].where;
      expect(where.userId).toBeUndefined();
      expect(where.AND).toEqual([{ OR: [{ userId: 'viewer' }, { folder: { is: { deletedAt: null, OR: [{ userId: 'viewer' }, { members: { some: { userId: 'viewer' } } }] } } }] }]);
      const sql = prisma.$queryRaw.mock.calls[0][0];
      expect(sql.sql).toContain('CASE WHEN b."userId"');
      expect(sql.sql).toContain("b.type = 'NOTE'");
      expect(sql.sql).toContain('folder_members');
      expect(sql.values).toContain('viewer');
      expect(where.id).toEqual({ in: [] });
      expect(where.folderId).toBeUndefined();
      expect(where.isArchived).toBeUndefined();
      expect(result.data[0]).toMatchObject({ canEdit: false, notes: null, noteDocument: null });
      await service.findAll('viewer', { search: 'reference', isTrash: true });
      expect(prisma.bookmark.findMany.mock.calls[1][0].where.userId).toBe('viewer');
      await service.findAll('viewer', { search: 'reference', isFavorite: true });
      expect(prisma.bookmark.findMany.mock.calls[2][0].where.userId).toBe('viewer');
      await service.findAll('viewer', { search: 'reference', isArchived: false });
      expect(prisma.bookmark.findMany.mock.calls[3][0].where.userId).toBe('viewer');
    });
  });

  describe('inspector autosave', () => {
    it('persists private notes and explicit clears only for the contributor', async () => {
      prisma.bookmark.findFirst.mockResolvedValue({ id: 'a', userId: 'owner' });
      await service.update('owner', 'a', { title: '', description: '', notes: 'My private draft', folderId: null, tags: [] });
      expect(prisma.bookmark.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: '', description: '', notes: 'My private draft', folderId: null }) }));
      await service.update('owner', 'a', { notes: '' });
      expect(prisma.bookmark.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ notes: '' }) }));
      prisma.bookmark.findFirst.mockResolvedValue(null);
      prisma.bookmark.update.mockClear();
      await expect(service.update('another-user', 'a', { notes: 'Forbidden' })).rejects.toThrow('Bookmark not found');
      expect(prisma.bookmark.update).not.toHaveBeenCalled();
    });

    it('validates notes and accepts a null folder without stripping the notes field', async () => {
      const dto = Object.assign(new UpdateBookmarkDto(), { notes: 'Keep this', folderId: null });
      expect(await validate(dto, { whitelist: true })).toHaveLength(0);
      expect(dto.notes).toBe('Keep this');
      expect(dto.folderId).toBeNull();
      expect(await validate(Object.assign(new UpdateBookmarkDto(), { notes: 123 }))).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'notes' })]));
    });
  });

  describe('image previews', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([
      ['https://share.redd.it/preview/post/1x9mx67', true],
      ['https://images.example.com/photo.jpg', false],
      ['https://share.redd.it.example.com/photo.jpg', false],
    ])('requests the appropriate image variant for %s', async (url, isRedditShare) => {
      const dns = require('node:dns/promises');
      jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      const pipe = jest.fn();
      const get = jest.spyOn(axios, 'get').mockResolvedValue({
        headers: { 'content-type': 'image/jpeg', 'content-length': '123' },
        data: { pipe },
      });
      const send = jest.fn();
      const status = jest.fn().mockReturnValue({ send });
      const res = { setHeader: jest.fn(), status, send } as unknown as Response;

      await service.proxyImage(url, res);

      const options = get.mock.calls[0][1]!;
      expect(get.mock.calls[0][0]).toBe(url);
      expect(options.headers!['User-Agent']).toEqual(
        isRedditShare ? CRAWLER_USER_AGENTS.WHATSAPP : expect.stringContaining('Chrome/'),
      );
      expect(options.headers!.Referer).toBe(new URL(url).origin);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
      expect(pipe).toHaveBeenCalledWith(res);
    });

    it.each([
      'http://127.0.0.1:4000/api',
      'http://localhost/secret.png',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.1/admin.png',
      'http://postgres:5432/db',
      'file:///etc/passwd',
    ])('blocks SSRF attempt to internal target %s with HTTP 400', async (disallowedUrl) => {
      const get = jest.spyOn(axios, 'get');
      const send = jest.fn();
      const status = jest.fn().mockReturnValue({ send });
      const res = { setHeader: jest.fn(), status, send } as unknown as Response;

      await service.proxyImage(disallowedUrl, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(send).toHaveBeenCalledWith(expect.stringContaining('Invalid or disallowed image URL'));
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('note autosave', () => {
    const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] };
    const snapshot = { title: 'My note', notes: 'Hello', noteDocument: document };

    it('creates a stable note ID and keeps structured content and its preview', async () => {
      prisma.bookmark.upsert.mockResolvedValue({ id: 'note-1' });
      await service.saveNote('user-1', 'note-1', snapshot);
      expect(prisma.bookmark.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'note-1', userId: 'user-1', type: 'NOTE', deletedAt: null },
        create: expect.objectContaining({ id: 'note-1', userId: 'user-1', type: 'NOTE', ...snapshot }),
        update: { ...snapshot, sortTitle: 'my note', noteRevision: { increment: 1 }, noteSaveId: null },
      }));
    });

    it('preserves folder and tags when updating an existing note', async () => {
      prisma.bookmark.findFirst.mockResolvedValue({ id: 'note-1', userId: 'user-1', type: 'NOTE', folderId: 'folder-1' });
      await service.saveNote('user-1', 'note-1', snapshot);
      const update = prisma.bookmark.upsert.mock.calls[0][0].update;
      expect(update).toEqual({ ...snapshot, sortTitle: 'my note', noteRevision: { increment: 1 }, noteSaveId: null });
      expect(update.folderId).toBeUndefined();
      expect(update.tags).toBeUndefined();
    });

    it.each([
      { userId: 'other-user', type: 'NOTE' },
      { userId: 'user-1', type: 'BOOKMARK' },
      { userId: 'user-1', type: 'NOTE', deletedAt: new Date() },
    ])('rejects another user, non-note, and deleted IDs', async (existing) => {
      prisma.bookmark.findFirst.mockResolvedValue(existing);
      await expect(service.saveNote('user-1', 'note-1', snapshot)).rejects.toThrow('Note not found');
      expect(prisma.bookmark.upsert).not.toHaveBeenCalled();
    });

    it('checks folder ownership before creating a note', async () => {
      prisma.folder.findFirst.mockResolvedValue(null);
      await expect(service.saveNote('user-1', 'note-1', { ...snapshot, folderId: 'folder-1' })).rejects.toThrow('Folder not found');
      expect(prisma.bookmark.upsert).not.toHaveBeenCalled();
    });

    it('rejects invalid document roots', async () => {
      await expect(service.saveNote('user-1', 'note-1', { ...snapshot, noteDocument: { type: 'paragraph' } })).rejects.toThrow('Invalid note document');
      expect(prisma.bookmark.upsert).not.toHaveBeenCalled();
    });

    it('handles concurrent creation without crossing ownership boundaries', async () => {
      prisma.bookmark.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'note-1', userId: 'user-1', type: 'NOTE' });
      prisma.bookmark.upsert.mockRejectedValue({ code: 'P2002' });
      await service.saveNote('user-1', 'note-1', snapshot);
      expect(prisma.bookmark.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'note-1', userId: 'user-1', type: 'NOTE', deletedAt: null }, data: { ...snapshot, sortTitle: 'my note', noteRevision: { increment: 1 }, noteSaveId: null },
      }));
    });
  });

  describe('link health filtering', () => {
    it('includes only URL bookmarks in broken-link results', async () => {
      prisma.bookmark.findMany.mockResolvedValue([]);
      prisma.bookmark.count.mockResolvedValue(0);

      await service.findAll('user-1', { status: 'BROKEN' });

      expect(prisma.bookmark.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ type: 'BOOKMARK', url: { not: null }, status: 'BROKEN' }),
      }));
    });

    it('counts broken and redirected URLs only, not notes', async () => {
      prisma.bookmark.count.mockResolvedValue(0);
      prisma.bookmark.groupBy.mockResolvedValue([]);
      await service.getHealthSummary('user-1');

      expect(prisma.bookmark.count).toHaveBeenNthCalledWith(2, { where: {
        userId: 'user-1', type: 'BOOKMARK', url: { not: null }, deletedAt: null, status: 'BROKEN',
      } });
      expect(prisma.bookmark.count).toHaveBeenNthCalledWith(3, { where: {
        userId: 'user-1', type: 'BOOKMARK', url: { not: null }, deletedAt: null, status: 'REDIRECTED',
      } });
    });
  });

  describe('findAll with isTrash filter', () => {
    it('should query deletedAt: { not: null } when isTrash is true', async () => {
      prisma.bookmark.findMany.mockResolvedValue([]);
      prisma.bookmark.count.mockResolvedValue(0);

      await service.findAll('user-1', { isTrash: true });

      expect(prisma.bookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            deletedAt: { not: null },
          }),
        }),
      );
    });

    it('should query deletedAt: null when isTrash is false or omitted', async () => {
      prisma.bookmark.findMany.mockResolvedValue([]);
      prisma.bookmark.count.mockResolvedValue(0);

      await service.findAll('user-1', {});

      expect(prisma.bookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            deletedAt: null,
          }),
        }),
      );
    });
  });

  describe('soft delete via remove', () => {
    it('should set deletedAt to a Date when removing a bookmark', async () => {
      prisma.bookmark.findFirst.mockResolvedValue({ id: 'bm-1', userId: 'user-1' });
      prisma.bookmark.update.mockResolvedValue({ id: 'bm-1', deletedAt: new Date() });

      await service.remove('user-1', 'bm-1');

      expect(prisma.bookmark.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bm-1' },
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
          }),
        }),
      );
    });
  });

  describe('exportBookmarks', () => {
    it('exports root and folder bookmarks in Netscape HTML format', async () => {
      prisma.folder.findMany.mockResolvedValue([
        {
          id: 'folder-1',
          name: 'Design',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          bookmarks: [
            {
              url: 'https://design.test',
              title: 'Design System',
              createdAt: new Date('2026-01-02T00:00:00Z'),
              tags: [{ name: 'ui' }],
            },
          ],
        },
      ]);
      prisma.bookmark.findMany.mockResolvedValue([
        {
          url: 'https://example.com',
          title: 'Example',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          tags: [],
        },
      ]);

      const html = await service.exportBookmarks('user-1');
      expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
      expect(html).toContain('Design</H3>');
      expect(html).toContain('HREF="https://design.test"');
      expect(html).toContain('TAGS="ui"');
      expect(html).toContain('HREF="https://example.com"');
    });
  });

  describe('restore', () => {
    it('should restore a soft-deleted bookmark by setting deletedAt to null', async () => {
      prisma.bookmark.findFirst.mockResolvedValue({
        id: 'bm-1',
        userId: 'user-1',
        deletedAt: new Date(),
        folderId: null,
      });
      prisma.bookmark.update.mockResolvedValue({ id: 'bm-1', deletedAt: null });

      const result = await service.restore('user-1', 'bm-1');

      expect(prisma.bookmark.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bm-1' },
          data: expect.objectContaining({
            deletedAt: null,
            folderId: null,
          }),
        }),
      );
      expect(result).toBeDefined();
    });

    it('should detach orphaned folderId if parent folder was deleted', async () => {
      prisma.bookmark.findFirst.mockResolvedValue({
        id: 'bm-1',
        userId: 'user-1',
        deletedAt: new Date(),
        folderId: 'folder-deleted',
      });
      prisma.folder.findFirst.mockResolvedValue(null);
      prisma.bookmark.update.mockResolvedValue({ id: 'bm-1', deletedAt: null, folderId: null });

      await service.restore('user-1', 'bm-1');

      expect(prisma.bookmark.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bm-1' },
          data: expect.objectContaining({
            deletedAt: null,
            folderId: null,
          }),
        }),
      );
    });
  });

  describe('bulkRestore', () => {
    it('should update multiple bookmarks setting deletedAt to null', async () => {
      prisma.bookmark.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.bulkRestore('user-1', ['id-1', 'id-2', 'id-3']);

      expect(prisma.bookmark.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['id-1', 'id-2', 'id-3'] },
          deletedAt: { not: null },
          AND: [{ OR: [{ userId: 'user-1' }, { folder: { is: { deletedAt: null, OR: [{ userId: 'user-1' }, { members: { some: { userId: 'user-1', role: 'EDITOR' } } }] } } }] }],
        },
        data: {
          deletedAt: null,
        },
      });
      expect(result.restored).toBe(3);
    });
  });

  describe('permanentDelete', () => {
    it('should delete bookmark permanently from database', async () => {
      prisma.bookmark.findFirst.mockResolvedValue({ id: 'bm-1', userId: 'user-1' });
      prisma.bookmark.delete.mockResolvedValue({ id: 'bm-1' });

      await service.permanentDelete('user-1', 'bm-1');

      expect(prisma.bookmark.delete).toHaveBeenCalledWith({
        where: { id: 'bm-1' },
      });
    });
  });

  describe('bulkTrash', () => {
    it('should soft delete multiple bookmarks via updateMany', async () => {
      prisma.bookmark.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.bulkTrash('user-1', ['id-1', 'id-2', 'id-3']);

      expect(prisma.bookmark.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['id-1', 'id-2', 'id-3'] },
          deletedAt: null,
          AND: [{ OR: [{ userId: 'user-1' }, { folder: { is: { deletedAt: null, OR: [{ userId: 'user-1' }, { members: { some: { userId: 'user-1', role: 'EDITOR' } } }] } } }] }],
        },
        data: {
          deletedAt: expect.any(Date),
        },
      });
      expect(result.trashed).toBe(3);
    });
  });

  describe('bulkArchive', () => {
    it('should archive multiple bookmarks', async () => {
      prisma.bookmark.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.bulkArchive('user-1', ['id-1', 'id-2'], true);

      expect(prisma.bookmark.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['id-1', 'id-2'] },
          userId: 'user-1',
          deletedAt: null,
        },
        data: {
          isArchived: true,
        },
      });
      expect(result.updated).toBe(2);
    });
  });

  describe('bulkMove', () => {
    it('should move multiple bookmarks to target folder', async () => {
      prisma.folder.findFirst.mockResolvedValue({ id: 'folder-1', userId: 'user-1' });
      prisma.bookmark.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.bulkMove('user-1', ['id-1', 'id-2'], 'folder-1');

      expect(prisma.folder.findFirst).toHaveBeenCalledWith({
        where: { id: 'folder-1', deletedAt: null, OR: [{ userId: 'user-1' }, { members: { some: { userId: 'user-1', role: { in: ['CONTRIBUTOR', 'EDITOR'] } } } }] },
      });
      expect(prisma.bookmark.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['id-1', 'id-2'] },
          userId: 'user-1',
          deletedAt: null,
        },
        data: {
          folderId: 'folder-1',
        },
      });
      expect(result.moved).toBe(2);
    });
  });

  describe('bulkPermanentDelete', () => {
    it('should delete multiple bookmarks permanently', async () => {
      prisma.bookmark.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.bulkPermanentDelete('user-1', ['id-1', 'id-2']);

      expect(prisma.bookmark.deleteMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['id-1', 'id-2'] },
          userId: 'user-1',
        },
      });
      expect(result.deleted).toBe(2);
    });
  });

  describe('emptyTrash', () => {
    it('should delete all bookmarks with deletedAt not null for user', async () => {
      prisma.bookmark.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.emptyTrash('user-1');

      expect(prisma.bookmark.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          deletedAt: { not: null },
        },
      });
      expect(result.deleted).toBe(5);
    });
  });

  describe('getHealthSummary', () => {
    it('should include trash count in health summary', async () => {
      prisma.bookmark.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(4);

      const summary = await service.getHealthSummary('user-1');

      expect(summary.total).toBe(10);
      expect(summary.trash).toBe(4);
    });
  });

  describe('importBookmarks', () => {
    it('queues a durable import rather than doing network or database work in the request', async () => {
      prisma.bookmark.create.mockResolvedValue({
        id: 'imported-bm-1',
        url: 'https://ui.shadcn.com',
        title: 'shadcn/ui',
      });

      const htmlContent = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><A HREF="https://ui.shadcn.com">shadcn/ui</A>
</DL><p>`;

      const result = await service.importBookmarks('user-1', htmlContent);

      expect(result).toMatchObject({ id: 'task-1', status: 'PENDING' });
      expect((service as any).tasks.create).toHaveBeenCalledWith('user-1', 'IMPORT', { html: htmlContent });
      expect(prisma.bookmark.create).not.toHaveBeenCalled();
      expect((service as any).metadataService.extract).not.toHaveBeenCalled();
    });
  });

  describe('enrichMissingMetadata', () => {
    it('queues only pending or failed web bookmarks, not completed items lacking a cover', async () => {
      prisma.bookmark.findMany.mockResolvedValue([
        { id: 'bm-1', url: 'https://example.com' },
        { id: 'bm-2', url: 'https://test.com' },
      ]);

      const result = await service.enrichMissingMetadata('user-1');

      expect(result.queued).toBe(2);
      expect(prisma.bookmark.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', deletedAt: null, type: 'BOOKMARK', url: { not: null }, metadataStatus: { in: ['PENDING', 'FAILED'] } } }));
      const queue = (service as any).metadataQueue;
      expect(queue.enqueue).toHaveBeenCalledWith({ id: 'bm-1', url: 'https://example.com' }, true);
      expect(queue.enqueue).toHaveBeenCalledWith({ id: 'bm-2', url: 'https://test.com' }, true);
    });
  });

  describe('fast bookmark creation', () => {
    it('saves immediately without requesting website metadata', async () => {
      prisma.bookmark.create.mockResolvedValue({ id: 'fast', url: 'https://react.dev/learn' });
      await service.create('user-1', { url: 'https://react.dev/learn' });
      expect((service as any).metadataService.extract).not.toHaveBeenCalled();
      expect(prisma.bookmark.create.mock.calls[0][0].data).toMatchObject({ title: 'react.dev', metadataStatus: 'PENDING' });
      expect((service as any).metadataQueue.enqueue).toHaveBeenCalledTimes(1);
    });
    it('keeps complete client metadata and skips unnecessary worker requests', async () => {
      prisma.bookmark.create.mockResolvedValue({ id: 'complete', url: 'https://react.dev/learn' });
      await service.create('user-1', { url: 'https://react.dev/learn', title: 'My reference', description: 'Page description', imageUrl: 'https://react.dev/cover.png' });
      expect(prisma.bookmark.create.mock.calls[0][0].data).toMatchObject({ title: 'My reference', description: 'Page description', metadataStatus: 'COMPLETED' });
      expect((service as any).metadataService.extract).not.toHaveBeenCalled();
      expect((service as any).metadataQueue.enqueue).not.toHaveBeenCalled();
    });
    it('queues manual link checks under the requesting account only', async () => {
      await service.triggerHealthCheck('user-1');
      expect((service as any).tasks.create).toHaveBeenCalledWith('user-1', 'LINK_CHECK');
    });
  });

  describe('highlights from the browser extension', () => {
    const highlight = {
      type: 'doc',
      content: [
        { type: 'blockquote', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'The next note you play' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'determines if it is good.' }] },
        ] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Miles', marks: [{ type: 'link', attrs: { href: 'https://example.com/a' } }] }] },
      ],
    };

    it('saves a highlight as a note on its page, searchable by its text, without fetching the page', async () => {
      prisma.bookmark.create.mockResolvedValue({ id: 'h1', type: 'NOTE', url: 'https://example.com/a' });
      await service.create('user-1', { type: 'NOTE' as any, url: 'https://example.com/a', title: 'Jazz', noteDocument: highlight });
      const data = prisma.bookmark.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ type: 'NOTE', url: 'https://example.com/a', notes: 'The next note you play\ndetermines if it is good.\nMiles', metadataStatus: 'COMPLETED' });
      expect((service as any).metadataService.extract).not.toHaveBeenCalled();
      expect((service as any).metadataQueue.enqueue).not.toHaveBeenCalled();
    });

    it('does not count highlights sharing a page address as duplicate links', async () => {
      await service.getDuplicates('user-1');
      expect(prisma.bookmark.groupBy.mock.calls[0][0].where).toEqual({ userId: 'user-1', deletedAt: null, type: 'BOOKMARK' });
    });
  });

  describe('rediscover', () => {
    beforeEach(() => {
      prisma.$queryRaw = jest.fn().mockResolvedValue([{ id: 'b' }, { id: 'a' }]);
      prisma.bookmark.findMany.mockResolvedValue([
        { id: 'a', userId: 'user-1', title: 'A' },
        { id: 'b', userId: 'user-1', title: 'B' },
      ]);
    });

    it('returns the shuffled own active items in the picked order', async () => {
      const items = await service.rediscover('user-1', 2);
      expect(items.map((item: any) => item.id)).toEqual(['b', 'a']);
      expect(items[0]).toMatchObject({ canEdit: true, access: 'owner' });
      const [sql, ...values] = prisma.$queryRaw.mock.calls[0];
      const query = sql.join('?');
      expect(query).toContain('"deletedAt" IS NULL AND "isArchived" = false');
      expect(query).toMatch(/ORDER BY \("createdAt" < now\(\) - interval '7 days'\) DESC, random\(\)/);
      expect(values).toEqual(['user-1', 2]);
      expect(prisma.bookmark.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['b', 'a'] }, userId: 'user-1', deletedAt: null });
    });

    it('rejects out-of-range limits and returns nothing for an empty library', async () => {
      await expect(service.rediscover('user-1', 0)).rejects.toThrow('Limit');
      await expect(service.rediscover('user-1', 51)).rejects.toThrow('Limit');
      prisma.$queryRaw.mockResolvedValue([]);
      expect(await service.rediscover('user-1')).toEqual([]);
      expect(prisma.bookmark.findMany).not.toHaveBeenCalled();
    });
  });
});

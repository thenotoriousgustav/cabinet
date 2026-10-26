// Isolated development fixtures, removed in finally. Build and migrate before running.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const { PrismaClient } = require("@prisma/client")
const { PrismaPg } = require("@prisma/adapter-pg")
const { BookmarksService } = require("../dist/modules/cabinet/bookmarks/bookmarks.service.js")
if (!process.env.DATABASE_URL || process.env.NODE_ENV === "production") throw new Error("Use a development database")
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const users = [randomUUID(), randomUUID(), randomUUID()]
const [owner, member, stranger] = users
const service = new BookmarksService(prisma, { extract: async () => ({}) }, { isVideoUrl: () => false }, { enqueue: async () => true }, {})
const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })
try {
  await prisma.user.createMany({ data: users.map((id) => ({ id, name: "Search/sync integration", email: `search-sync-${id}@example.test` })) })
  const folder = await prisma.folder.create({ data: { userId: owner, name: "Search shared fixture", members: { create: { userId: member, role: "EDITOR" } } } })
  const title = await service.create(owner, { title: "Javascript reference", url: "https://example.test/title", folderId: folder.id })
  const description = await service.create(owner, { title: "A reference", description: "Javascript", url: "https://other.test/description" })
  const noteId = randomUUID()
  const initial = { title: "A private note", notes: "Javascript text", noteDocument: doc("Javascript text"), baseRevision: 0, saveId: randomUUID() }
  await service.saveNote(owner, noteId, initial)
  const page1 = await service.findAll(owner, { search: "Javascript", limit: 1 })
  assert.equal(page1.totalCount, 3)
  assert.equal(page1.data[0].id, title.id)
  const page2 = await service.findAll(owner, { search: "Javascript", limit: 1, cursor: page1.nextCursor })
  assert.equal(page2.data[0].id, description.id)
  const page3 = await service.findAll(owner, { search: "Javascript", limit: 1, cursor: page2.nextCursor })
  assert.equal(page3.data[0].id, noteId)
  assert.equal(page3.nextCursor, null)
  assert.equal((await service.findAll(owner, { search: "Javscript" })).data[0].id, title.id)
  assert.equal((await service.findAll(owner, { search: "Javascript reference" })).totalCount, 2)
  assert.equal((await service.findAll(owner, { search: "Javascript", domain: "example.test" })).totalCount, 1)
  assert.equal((await service.findAll(owner, { search: "Javascript", type: "NOTE" })).totalCount, 1)
  assert.equal((await service.findAll(owner, { search: "Javascript", addedBefore: "2000-01-01" })).totalCount, 0)
  assert.equal((await service.findAll(owner, { search: "%_" })).totalCount, 0)
  await assert.rejects(() => service.findAll(owner, { addedAfter: "2026-99-01" }), /Invalid date/)
  await assert.rejects(() => service.findAll(owner, { addedAfter: "2026-02-30" }), /Invalid date/)
  await assert.rejects(() => service.findAll(owner, { domain: "https://example.test" }), /domain/)
  await prisma.bookmark.update({ where: { id: title.id }, data: { notes: "privatetoken", noteDocument: doc("privatetoken") } })
  assert.equal((await service.findAll(member, { search: "Javascript" })).totalCount, 1)
  assert.equal((await service.findAll(member, { search: "privatetoken" })).totalCount, 0)
  assert.equal((await service.findAll(stranger, { search: "Javascript" })).totalCount, 0)
  await service.saveNote(owner, noteId, { ...initial, folderId: folder.id, baseRevision: 1, saveId: randomUUID() })
  assert.equal((await service.findAll(member, { search: "Javascript text" })).data[0].id, noteId)
  const savedSearch = await service.saveSearch(owner, { name: "JS references", url: "/cabinet?q=Javascript&domain=example.test" })
  assert.equal((await service.savedSearches(owner))[0].id, savedSearch.id)
  assert.equal((await service.savedSearches(member)).length, 0)
  await service.deleteSearch(member, savedSearch.id)
  assert.equal((await service.savedSearches(owner)).length, 1)

  const request = { title: "Offline save", url: "https://example.test/offline", clientRequestId: randomUUID(), expectedUserId: owner }
  const [a, b] = await Promise.all([service.create(owner, request), service.create(owner, request)])
  assert.equal(a.id, b.id)
  assert.equal(await prisma.bookmark.count({ where: { userId: owner, clientRequestId: request.clientRequestId } }), 1)
  await assert.rejects(() => service.create(member, request), /another account/)
  const revision = (await service.findOne(owner, noteId)).noteRevision
  const next = { ...initial, title: "Tab A", baseRevision: revision, saveId: randomUUID() }
  const saved = await service.saveNote(owner, noteId, next)
  assert.equal(saved.noteRevision, revision + 1)
  assert.equal((await service.saveNote(owner, noteId, next)).noteRevision, saved.noteRevision)
  await assert.rejects(() => service.saveNote(member, noteId, { ...next, saveId: randomUUID(), title: "Tab B" }), /changed in another/)
  const results = await Promise.allSettled(["C", "D"].map((title) => service.saveNote(owner, noteId, { ...next, title, saveId: randomUUID(), baseRevision: saved.noteRevision })))
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1)
  assert.equal(results.filter((result) => result.status === "rejected").length, 1)
  const editorRevision = (await service.findOne(member, noteId)).noteRevision
  const editorWrite = { ...next, title: "Shared editor retry", baseRevision: editorRevision, saveId: randomUUID(), tags: ["must-not-change-author-tags"] }
  const editorResults = await Promise.all([service.saveNote(member, noteId, editorWrite), service.saveNote(member, noteId, editorWrite)])
  assert.equal(editorResults[0].noteRevision, editorResults[1].noteRevision)
  assert.deepEqual((await service.findOne(owner, noteId)).tags, [])
  await prisma.folderMember.delete({ where: { folderId_userId: { folderId: folder.id, userId: member } } })
  assert.equal((await service.findAll(member, { search: "Javascript" })).totalCount, 0)
  console.log("PASS ranking, typo tolerance, multiword search, filters, pagination, shared-data privacy, saved-search ownership, idempotent concurrent creates and revision conflicts")
} finally {
  await prisma.user.deleteMany({ where: { id: { in: users } } })
  await prisma.$disconnect()
}

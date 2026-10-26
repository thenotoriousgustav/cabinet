import { validate } from "class-validator"
import { SavedSearchDto } from "./dto/saved-search.dto"
import { SaveNoteDto } from "./dto/save-note.dto"
import { bookmarkSearchQuery, searchRefinements } from "./bookmark-search"

const user = "11111111-1111-4111-8111-111111111111"
describe("search request boundaries", () => {
  it("accepts only relative Cabinet library URLs for saved searches", async () => {
    for (const url of ["/cabinet?q=React", "/cabinet/favorites?format=notes", "/cabinet/tags/design?q=ui"]) {
      expect(await validate(Object.assign(new SavedSearchDto(), { name: "References", url }))).toEqual([])
    }
    for (const url of ["https://evil.test", "//evil.test", "javascript:alert(1)", "/login", "/cabinet/notes/secret"]) {
      expect((await validate(Object.assign(new SavedSearchDto(), { name: "References", url }))).length).toBeGreaterThan(0)
    }
  })
  it("validates revisions and save IDs at the DTO boundary", async () => {
    const dto = Object.assign(new SaveNoteDto(), { noteDocument: { type: "doc", content: [] }, baseRevision: -1, saveId: "not-a-uuid" })
    expect((await validate(dto)).map((error) => error.property).sort()).toEqual(["baseRevision", "saveId"])
  })
  it("rejects invalid dates, ranges, non-string filters and invalid cursors", () => {
    for (const filters of [{ addedAfter: "2026-02-30" }, { addedBefore: "2026-99-01" }, { addedAfter: "2026-02-01", addedBefore: "2026-01-01" }, { domain: "https://react.dev" }, { search: ["invalid"] }]) {
      expect(() => searchRefinements(filters as any)).toThrow()
    }
    expect(() => bookmarkSearchQuery(user, { search: "x".repeat(201) })).toThrow("200 characters")
    expect(() => bookmarkSearchQuery(user, { search: "React", cursor: "invalid" })).toThrow("cursor")
  })
  it("keeps hostile search text in SQL parameters and never interpolates it", () => {
    const query = bookmarkSearchQuery(user, { search: "';DROP TABLE bookmarks;--" })
    expect(query.sql).not.toContain("DROP TABLE")
    expect(query.values).toContain("';drop")
    expect(query.sql).toContain("folder_members")
    expect(query.sql).toContain("CASE WHEN b.\"userId\"")
  })
})

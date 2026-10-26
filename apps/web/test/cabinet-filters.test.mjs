import assert from "node:assert/strict"
import test from "node:test"
import { buildCabinetUrl, parseCabinetLocation } from "../src/lib/cabinet-url.ts"

const id = "12345678-1234-4234-8234-123456789abc"

test("primary location lives in the path", () => {
  assert.equal(buildCabinetUrl({}).url, "/cabinet")
  assert.equal(buildCabinetUrl({ view: "favorites" }).url, "/cabinet/favorites")
  assert.equal(buildCabinetUrl({ folderId: id }).url, `/cabinet/folders/${id}`)
  assert.equal(buildCabinetUrl({ tag: "a b" }).url, "/cabinet/tags/a%20b")
})

test("refinements stay in the query", () => {
  assert.equal(
    buildCabinetUrl({ view: "trash", tag: "x", format: "notes", q: " hi ", sort: "newest" }).url,
    "/cabinet/trash?tag=x&format=notes&q=hi&sort=newest"
  )
  assert.equal(buildCabinetUrl({ format: "all", sort: "custom" }).url, "/cabinet")
})

test("parse round-trips build and accepts legacy query URLs", () => {
  const loc = { folderId: id, format: "links", q: "design", sort: "newest" }
  const { url } = buildCabinetUrl(loc)
  const [path, search = ""] = url.split("?")
  assert.deepEqual(parseCabinetLocation(path, search ? `?${search}` : ""), { ...loc, tag: undefined, view: undefined, domain: undefined, addedAfter: undefined, addedBefore: undefined })
  assert.equal(parseCabinetLocation("/cabinet", `?folder=${id}`).folderId, id)
  assert.equal(parseCabinetLocation("/cabinet", "?view=archive").view, "archive")
  assert.equal(parseCabinetLocation("/cabinet", "?view=notes").format, "notes")
  assert.equal(parseCabinetLocation("/cabinet/tags/a%20b", "").tag, "a b")
  assert.equal(parseCabinetLocation("/cabinet/folders/nope", "").folderId, undefined)
})

test("the drawings format round-trips through the URL", () => {
  assert.equal(buildCabinetUrl({ format: "drawings" }).url, "/cabinet?format=drawings")
  assert.equal(parseCabinetLocation("/cabinet", "?format=drawings").format, "drawings")
})

test("the documents format round-trips through the URL", () => {
  assert.equal(buildCabinetUrl({ format: "documents" }).url, "/cabinet?format=documents")
  assert.equal(parseCabinetLocation("/cabinet", "?format=documents").format, "documents")
})

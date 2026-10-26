import assert from "node:assert/strict"
import test from "node:test"
import { readBookmarkImport } from "../src/lib/import-bookmarks.ts"

test("imports accept browser HTML exports and reject oversized or unsupported files before reading", async () => {
  let reads = 0
  const text = async () => { reads++; return '<A HREF="https://react.dev">React</A>' }
  for (const name of ["Bookmarks.html", "bookmarks.HTM"]) assert.match(await readBookmarkImport({ name, size: 100, text }), /react\.dev/)
  assert.equal(reads, 2)
  await assert.rejects(() => readBookmarkImport({ name: "notes.pdf", size: 100, text }), /HTML/)
  await assert.rejects(() => readBookmarkImport({ name: "bookmarks.html", size: 1000001, text }), /1 MB/)
  assert.equal(reads, 2)
})

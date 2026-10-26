import assert from "node:assert/strict"
import test from "node:test"
import { VersionedNoteSave } from "../src/lib/note-save.ts"
import { NoteAutosave } from "../src/lib/note-autosave.ts"
import { searchHighlightParts } from "../src/lib/search-highlight.ts"
import { buildCabinetUrl, parseCabinetLocation } from "../src/lib/cabinet-url.ts"

const snapshot = (title) => ({ title, notes: title, noteDocument: { type: "doc", content: [] } })
test("lost responses retry the same operation before newer typing", async () => {
  const requests = [], committed = new Map()
  let revision = 0, loseResponse = true
  const writer = new VersionedNoteSave(0, async (body) => {
    requests.push(body)
    if (committed.has(body.saveId)) return committed.get(body.saveId)
    assert.equal(body.baseRevision, revision)
    const result = { noteRevision: ++revision }
    committed.set(body.saveId, result)
    if (loseResponse) { loseResponse = false; throw new Error("Lost response") }
    return result
  })
  await assert.rejects(() => writer.save(snapshot("First")))
  await writer.save(snapshot("Latest"))
  assert.deepEqual(requests.map((body) => body.title), ["First", "First", "Latest"])
  assert.equal(requests[0].saveId, requests[1].saveId)
  assert.equal(requests[2].baseRevision, 1)
  assert.equal(writer.revision, 2)
})
test("conflicts stop autosaves even while typing until explicitly resolved", async () => {
  const states = [], saved = []
  let fail = true
  const queue = new NoteAutosave(async (body) => {
    if (fail) throw { response: { status: 409 } }
    saved.push(body.title)
  }, (status) => states.push(status), 60000, { retry: true })
  queue.schedule(snapshot("Old tab"))
  assert.equal(await queue.flush(), false)
  assert.equal(states.at(-1), "conflict")
  queue.schedule(snapshot("Keep latest draft"))
  assert.equal(await queue.flush(), false)
  assert.equal(states.at(-1), "conflict")
  fail = false
  assert.equal(await queue.resume(), true)
  assert.deepEqual(saved, ["Keep latest draft"])
  queue.dispose()
})
test("retriable failures expose waiting-to-sync, and retain the draft", async () => {
  const states = []
  const queue = new NoteAutosave(async () => { throw { response: { status: 503 } } }, (status) => states.push(status), 60000, { retry: true })
  queue.schedule(snapshot("Offline"))
  assert.equal(await queue.flush(), false)
  assert.equal(states.at(-1), "offline")
  assert.equal(queue.hasUnsavedChanges, true)
  queue.dispose()
})
test("highlighting is literal, merges overlaps, handles typos, and never returns HTML", () => {
  assert.deepEqual(searchHighlightParts("JavaScript", "script javascript"), [{ text: "JavaScript", match: true }])
  assert.deepEqual(searchHighlightParts("<script>React</script>", "React").filter((part) => part.match), [{ text: "React", match: true }])
  assert.deepEqual(searchHighlightParts("JavaScript", "JavScript"), [{ text: "JavaScript", match: true }])
  assert.deepEqual(searchHighlightParts("100% _ literal", "% _").filter((part) => part.match).map((part) => part.text), ["%", "_"])
})
test("saved-search URLs preserve every refinement", () => {
  const location = { q: "React patterns", domain: "react.dev", addedAfter: "2026-01-01", addedBefore: "2026-02-01", tag: "reading", format: "links", sort: "relevance" }
  const { url } = buildCabinetUrl(location)
  const [path, search] = url.split("?")
  const parsed = parseCabinetLocation(path, `?${search}`)
  for (const [key, value] of Object.entries(location)) assert.equal(parsed[key], value)
})

import assert from "node:assert/strict"
import test from "node:test"
import { createOutbox } from "../src/outbox.js"

function fixture() {
  let items = [], user = { id: "a" }, apiUrl = "https://api.test", failure
  const sent = []
  const options = {
    load: async () => structuredClone(items),
    store: async (next) => { items = structuredClone(next) },
    session: async () => user,
    settings: async () => ({ apiUrl }),
    send: async (body) => { sent.push(structuredClone(body)); if (failure) throw failure },
    uuid: () => `request-${Math.random()}`,
  }
  return { options, sent, items: () => items, user: (next) => { user = next }, origin: (next) => { apiUrl = next }, fail: (next) => { failure = next } }
}

test("offline saves persist before send, survive worker restart, and reuse the same ID", async () => {
  const f = fixture()
  f.fail(Object.assign(new Error("Offline"), { retryable: true }))
  const queue = createOutbox(f.options)
  assert.equal((await queue.save({ title: "Keep me" })).queued, true)
  const id = f.items()[0].body.clientRequestId
  assert.equal(f.items()[0].body.expectedUserId, "a")
  assert.equal(f.items()[0].body.source, "EXTENSION")
  f.fail(null)
  await createOutbox(f.options).flush()
  assert.equal(f.items().length, 0)
  assert.deepEqual(f.sent.map((body) => body.clientRequestId), [id, id])
})

test("another account or API never receives queued data", async () => {
  const f = fixture()
  f.user({ id: "a", offline: true })
  await createOutbox(f.options).save({ title: "Private highlight" })
  f.user({ id: "b" })
  await createOutbox(f.options).flush()
  assert.equal(f.sent.length, 0)
  assert.deepEqual(await createOutbox(f.options).list(), [])
  f.user({ id: "a" }); f.origin("https://elsewhere.test")
  await createOutbox(f.options).flush()
  assert.equal(f.sent.length, 0)
  assert.equal(f.items().length, 1)
})

test("concurrent saves are serialized and permanent failures require explicit retry", async () => {
  const f = fixture()
  f.fail(Object.assign(new Error("Folder no longer writable"), { status: 404 }))
  const queue = createOutbox(f.options)
  await Promise.all([queue.save({ title: "One" }), queue.save({ title: "Two" })])
  assert.equal(f.items().length, 2)
  assert.ok(f.items().every((item) => item.status === "blocked"))
  assert.equal(f.sent.length, 2)
  await queue.flush()
  assert.equal(f.sent.length, 2)
  f.fail(null)
  await queue.retry()
  assert.equal(f.items().length, 0)
  assert.equal(f.sent.length, 4)
})

test("signed-out users cannot enqueue data and other accounts cannot discard it", async () => {
  const f = fixture(), queue = createOutbox(f.options)
  f.user({ id: "a", offline: true })
  await queue.save({ title: "Keep" })
  const id = f.items()[0].id
  f.user({ id: "b" })
  await queue.discard(id)
  assert.equal(f.items().length, 1)
  f.user(null)
  await assert.rejects(() => queue.save({ title: "No identity" }), /Sign in/)
  f.user({ id: "a" })
  await queue.discard(id)
  assert.equal(f.items().length, 0)
})

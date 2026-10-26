/** One worker owns all writes, including popup saves, so storage updates cannot race. */
export function createOutbox({ load, store, session, send, settings, uuid = () => crypto.randomUUID() }) {
  let serial = Promise.resolve()
  const exclusive = (run) => {
    const result = serial.then(run)
    serial = result.catch(() => {})
    return result
  }
  const flush = async (items) => {
    const origin = (await settings()).apiUrl
    const user = await session()
    for (const item of items) {
      if (!user || user.offline || user.id !== item.userId || origin !== item.apiUrl || item.status === "blocked") continue
      try {
        await send(item.body)
        items = items.filter((entry) => entry.id !== item.id)
      } catch (error) {
        item.status = error.retryable || error.name === "SignedOutError" ? "pending" : "blocked"
        item.error = error.message
        if (error.retryable || error.name === "SignedOutError") {
          await store(items)
          break
        }
      }
      await store(items)
    }
    return items
  }
  return {
    save: (body) => exclusive(async () => {
      const user = await session()
      if (!user) throw new Error("Sign in to Cabinet once before saving offline.")
      const { apiUrl } = await settings()
      const id = uuid()
      const item = { id, userId: user.id, apiUrl, createdAt: new Date().toISOString(), status: "pending", body: { ...body, source: "EXTENSION", clientRequestId: id, expectedUserId: user.id } }
      const items = await load()
      items.push(item)
      // Persist before sending: closing the popup or losing a response cannot lose the request ID.
      await store(items)
      const remaining = await flush(items)
      const pending = remaining.find((entry) => entry.id === id)
      return { queued: !!pending, status: pending?.status, error: pending?.error }
    }),
    flush: () => exclusive(async () => flush(await load())),
    list: () => exclusive(async () => {
      const user = await session()
      const { apiUrl } = await settings()
      return (await load()).filter((item) => item.userId === user?.id && item.apiUrl === apiUrl)
    }),
    retry: () => exclusive(async () => {
      const user = await session()
      const { apiUrl } = await settings()
      const items = await load()
      for (const item of items) if (item.userId === user?.id && item.apiUrl === apiUrl) { item.status = "pending"; delete item.error }
      await store(items)
      return flush(items)
    }),
    discard: (id) => exclusive(async () => {
      const user = await session()
      const { apiUrl } = await settings()
      await store((await load()).filter((item) => !(item.id === id && item.userId === user?.id && item.apiUrl === apiUrl)))
    }),
  }
}

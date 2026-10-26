import { readMetadataHtml, MAX_METADATA_HTML_BYTES } from "./metadata-body"

describe("bounded metadata HTML", () => {
  it("cancels a large response as soon as the prefix limit is reached", async () => {
    let chunks = 0, cancelled = false
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { chunks++; controller.enqueue(new TextEncoder().encode("x".repeat(262144))) }, cancel() { cancelled = true } })
    const html = await readMetadataHtml(new Response(stream))
    expect(html.length).toBe(MAX_METADATA_HTML_BYTES)
    expect(chunks).toBeLessThanOrEqual(5)
    expect(cancelled).toBe(true)
  })
  it("keeps UTF-8 characters split across chunks", async () => {
    const text = "<title>日本語 & React</title>", bytes = new TextEncoder().encode(text)
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 9)); controller.enqueue(bytes.slice(9)); controller.close() } })
    expect(await readMetadataHtml(new Response(stream))).toBe(text)
  })
})

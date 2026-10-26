export const MAX_METADATA_HTML_BYTES = 1024 * 1024

/** OpenGraph lives near the head. Bound memory/network use instead of buffering an entire page. */
export async function readMetadataHtml(response: Response, limit = MAX_METADATA_HTML_BYTES) {
  if (!response.body) return ""
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let bytes = 0, html = ""
  try {
    while (bytes < limit) {
      const { done, value } = await reader.read()
      if (done) break
      const part = value.subarray(0, limit - bytes)
      html += decoder.decode(part, { stream: true })
      bytes += part.byteLength
    }
    return html + decoder.decode()
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

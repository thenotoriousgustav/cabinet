import { parseBookmarkImport } from "./bookmark-import"
import { stableTaskId } from "../services/background-tasks.service"

describe("bookmark imports", () => {
  it("preserves nested folders, arbitrary attribute order, Unicode and HTML entities", () => {
    const html = `<DL><DT><H3>Design &amp; code</H3><DL><A TAGS="UI, ui,研究" ADD_DATE="1" HREF="https://react.dev/learn?a=1&amp;b=2">React &amp; learning</A><H3>Nested</H3><DL><A HREF='https://developer.mozilla.org/'>日本語</A></DL><A HREF="https://www.w3.org/">Parent again</A></DL><A HREF="https://www.rust-lang.org/">Root</A></DL>`
    const { entries, skipped } = parseBookmarkImport(html)
    expect(skipped).toBe(0)
    expect(entries).toEqual([
      { kind: "folder", title: "Design & code", parent: null },
      { kind: "bookmark", title: "React & learning", url: "https://react.dev/learn?a=1&b=2", tags: ["ui", "研究"], parent: 0 },
      { kind: "folder", title: "Nested", parent: 0 },
      { kind: "bookmark", title: "日本語", url: "https://developer.mozilla.org/", tags: [], parent: 2 },
      { kind: "bookmark", title: "Parent again", url: "https://www.w3.org/", tags: [], parent: 0 },
      { kind: "bookmark", title: "Root", url: "https://www.rust-lang.org/", tags: [], parent: null },
    ])
  })
  it("skips unsupported schemes and rejects files with no usable bookmarks", () => {
    const html = `<A HREF="javascript:alert(1)">Unsafe</A><A HREF="file:///etc/passwd">Local</A><A HREF="https://react.dev">Good</A>`
    expect(parseBookmarkImport(html).skipped).toBe(2)
    expect(() => parseBookmarkImport("<html>No links</html>")).toThrow("No supported")
  })
  it("generates stable UUIDs per import operation, not per user or URL", () => {
    expect(stableTaskId("task1:bookmark:5")).toBe(stableTaskId("task1:bookmark:5"))
    expect(stableTaskId("task1:bookmark:5")).not.toBe(stableTaskId("task2:bookmark:5"))
    expect(stableTaskId("task1:bookmark:5")).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/)
  })
})

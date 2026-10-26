export function searchHighlightParts(text: string, query: string) {
  const terms = [...new Set(query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean))].slice(0, 10)
  if (!terms.length) return [{ text, match: false }]
  const lower = text.toLocaleLowerCase()
  const ranges: Array<[number, number]> = []
  for (const term of terms) {
    let at = lower.indexOf(term)
    while (at >= 0) { ranges.push([at, at + term.length]); at = lower.indexOf(term, at + term.length) }
  }
  // A small edit-distance check highlights likely typo matches without rendering server HTML.
  for (const word of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const value = word[0].toLocaleLowerCase()
    if (terms.some((term) => term.length >= 4 && Math.abs(value.length - term.length) <= 1 && oneEditAway(term, value))) ranges.push([word.index!, word.index! + word[0].length])
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const range of ranges) {
    const last = merged.at(-1)
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([...range])
  }
  const parts: Array<{ text: string; match: boolean }> = []
  let from = 0
  for (const [start, end] of merged) {
    if (start > from) parts.push({ text: text.slice(from, start), match: false })
    parts.push({ text: text.slice(start, end), match: true })
    from = end
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false })
  return parts
}
function oneEditAway(a: string, b: string) {
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length >= b.length) i++
    if (b.length >= a.length) j++
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

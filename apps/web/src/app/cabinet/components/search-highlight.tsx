"use client"

import { createContext, useContext } from "react"
import { searchHighlightParts } from "@/lib/search-highlight"

export const SearchQueryContext = createContext("")
export function SearchHighlight({ text }: { text?: string | null }) {
  const query = useContext(SearchQueryContext)
  if (!text) return null
  return searchHighlightParts(text, query).map((part, index) => part.match
    ? <mark key={index} className="rounded-xs bg-accent text-accent-foreground underline decoration-current/40 underline-offset-2">{part.text}</mark>
    : part.text)
}

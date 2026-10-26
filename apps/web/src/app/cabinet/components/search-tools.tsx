"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { BookmarkSimple, Funnel, Trash } from "@phosphor-icons/react"
import { AXIOS_INSTANCE } from "@/lib/api-client"
import { buildCabinetUrl, type CabinetLocation } from "@/lib/cabinet-url"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/sonner"

export function SearchTools({ userId, location, onRefine, tags, onSelectTag }: {
  userId: string
  location: CabinetLocation
  onRefine: (values: { domain: string; addedAfter: string; addedBefore: string }) => void
  tags: { name: string }[]
  onSelectTag: (tag?: string) => void
}) {
  const cache = useQueryClient()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [domain, setDomain] = useState(location.domain || "")
  const [after, setAfter] = useState(location.addedAfter || "")
  const [before, setBefore] = useState(location.addedBefore || "")
  const { data: saved = [], isError, refetch } = useQuery({
    queryKey: ["saved-searches", userId],
    queryFn: async (): Promise<{ id: string; name: string; url: string }[]> => {
      const response = await AXIOS_INSTANCE.get("/v1/bookmarks/saved-searches")
      const items = response.data.data ?? response.data
      if (!Array.isArray(items)) throw new Error("Invalid saved searches response")
      return items
    },
  })
  const active = [location.domain, location.addedAfter || location.addedBefore, location.tag].filter(Boolean).length
  const url = buildCabinetUrl(location).url
  return <div className="flex flex-wrap items-center gap-2" aria-label="Search refinements">
    <Popover open={open} onOpenChange={(next) => {
      if (next) { setDomain(location.domain || ""); setAfter(location.addedAfter || ""); setBefore(location.addedBefore || "") }
      setOpen(next)
    }}>
      <PopoverTrigger asChild><Button variant="outline" size="sm"><Funnel data-icon="inline-start" />Filters{active ? ` (${active})` : ""}</Button></PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <form onSubmit={(event) => { event.preventDefault(); onRefine({ domain: domain.trim().replace(/^www\./, ""), addedAfter: after, addedBefore: before }); setOpen(false) }}>
          <FieldGroup>
            <Field><FieldLabel htmlFor="search-domain">Domain</FieldLabel><Input id="search-domain" placeholder="react.dev" value={domain} onChange={(event) => setDomain(event.target.value)} pattern="[a-zA-Z0-9.\-]+" /></Field>
            <Field><FieldLabel htmlFor="search-after">Added from (UTC)</FieldLabel><Input id="search-after" type="date" value={after} max={before || undefined} onChange={(event) => setAfter(event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="search-before">Added through (UTC)</FieldLabel><Input id="search-before" type="date" value={before} min={after || undefined} onChange={(event) => setBefore(event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="search-tag">Tag</FieldLabel><Select value={location.tag || "__all__"} onValueChange={(value) => onSelectTag(value === "__all__" ? undefined : value)}><SelectTrigger id="search-tag"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="__all__">All tags</SelectItem>{tags.map((tag) => <SelectItem key={tag.name} value={tag.name}>#{tag.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <div className="flex gap-2"><Button type="submit" size="sm">Apply filters</Button><Button type="button" variant="ghost" size="sm" onClick={() => { onRefine({ domain: "", addedAfter: "", addedBefore: "" }); onSelectTag(undefined); setOpen(false) }}>Clear filters</Button></div>
          </FieldGroup>
        </form>
      </PopoverContent>
    </Popover>
    {location.domain && <span className="text-sm text-muted-foreground">{location.domain}</span>}
    {(location.addedAfter || location.addedBefore) && <span className="text-sm text-muted-foreground">{location.addedAfter || "Any date"} – {location.addedBefore || "Today"}</span>}
    <Popover>
      <PopoverTrigger asChild><Button variant="ghost" size="sm"><BookmarkSimple data-icon="inline-start" />Saved searches</Button></PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Saved searches</p>
          {isError ? <Button variant="outline" size="sm" onClick={() => void refetch()}>Could not load · Retry</Button> : saved.length === 0 ? <p className="text-sm text-muted-foreground">Save this search and its filters to use on any device.</p> : <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">{saved.map((item) => <li key={item.id} className="flex items-center gap-2"><a href={item.url} className="min-w-0 flex-1 truncate py-2 text-sm hover:underline">{item.name}</a><Button variant="ghost" size="icon-sm" aria-label={`Delete saved search ${item.name}`} onClick={async () => {
            try { await AXIOS_INSTANCE.delete(`/v1/bookmarks/saved-searches/${item.id}`); await cache.invalidateQueries({ queryKey: ["saved-searches", userId] }) }
            catch { toast.error("Could not delete saved search") }
          }}><Trash /></Button></li>)}</ul>}
          <form onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            try {
              await AXIOS_INSTANCE.post("/v1/bookmarks/saved-searches", { name: name.trim(), url })
              setName("")
              await cache.invalidateQueries({ queryKey: ["saved-searches", userId] })
              toast.success("Search saved")
            } catch { toast.error("Could not save search") }
            finally { setBusy(false) }
          }}><FieldGroup><Field><FieldLabel htmlFor="saved-search-name">Save current search</FieldLabel><Input id="saved-search-name" placeholder="Search name" maxLength={80} required value={name} onChange={(event) => setName(event.target.value)} /></Field><Button type="submit" size="sm" disabled={busy || !name.trim()}>Save search</Button></FieldGroup></form>
        </div>
      </PopoverContent>
    </Popover>
    {location.q && <span className="text-xs text-muted-foreground" role="status">{!location.sort || location.sort === "custom" || location.sort === "relevance" ? "Best matches first · typo tolerant" : "Typo tolerant search"}</span>}
  </div>
}

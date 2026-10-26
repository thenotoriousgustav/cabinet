"use client"

import { useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { ActivityOverview, CabinetActivity } from "@cabinet/api-client"
import { AXIOS_INSTANCE } from "./api-client"

export async function activityOverview(): Promise<ActivityOverview> {
  const response = await AXIOS_INSTANCE.get("/v1/activity/overview")
  const value = response.data.data ?? response.data
  if (!value?.onboarding || typeof value.pending !== "number") throw new Error("Invalid activity response")
  return value
}
export function useActivityOverview(userId?: string) {
  const cache = useQueryClient()
  const previous = useRef<string | null>(null)
  const query = useQuery({
    queryKey: ["activity-overview", userId], queryFn: activityOverview, enabled: !!userId, staleTime: 10000,
    refetchInterval: (query) => query.state.data && query.state.data.pending + query.state.data.running > 0 ? 5000 : 30000,
  })
  const signature = query.data ? `${userId}:${query.data.pending}:${query.data.running}:${query.data.completed}:${query.data.failed}` : null
  useEffect(() => {
    if (signature && previous.current && signature !== previous.current) {
      for (const key of [["/v1/bookmarks"], ["infinite", "/v1/bookmarks"], ["/v1/folders"], ["/v1/bookmarks/health"]]) void cache.invalidateQueries({ queryKey: key })
    }
    previous.current = signature
  }, [signature, cache])
  return query
}
export async function cabinetActivity(page = 1): Promise<CabinetActivity> {
  const response = await AXIOS_INSTANCE.get("/v1/activity", { params: { page } })
  const value = response.data.data ?? response.data
  if (!Array.isArray(value?.tasks) || !Array.isArray(value?.metadata) || !value?.summary) throw new Error("Invalid activity response")
  return value
}
export async function setOnboardingDismissed(dismissed: boolean) {
  await AXIOS_INSTANCE.patch("/v1/activity/onboarding", { dismissed })
}

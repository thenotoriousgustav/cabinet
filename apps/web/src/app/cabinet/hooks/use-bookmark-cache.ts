import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

export function useBookmarkCache() {
  const queryClient = useQueryClient()

  const updateBookmarkInCache = useCallback(
    (id: string, updater: (bookmark: any) => any) => {
      queryClient.setQueriesData(
        { queryKey: ["infinite", "/v1/bookmarks"] },
        (oldData: any) => {
          if (!oldData?.pages) return oldData
          return {
            ...oldData,
            pages: oldData.pages.map((page: any) => {
              const currentItems = page?.data?.data
              if (!Array.isArray(currentItems)) return page
              return {
                ...page,
                data: {
                  ...page.data,
                  data: currentItems.map((b: any) =>
                    b.id === id ? updater(b) : b
                  ),
                },
              }
            }),
          }
        }
      )
      queryClient.setQueriesData(
        { queryKey: ["/v1/bookmarks"] },
        (oldData: any) => {
          if (!oldData) return oldData
          const dataArray = oldData.data?.data || oldData.data
          if (!Array.isArray(dataArray)) return oldData
          const updated = dataArray.map((b: any) => (b.id === id ? updater(b) : b))
          if (oldData.data?.data) {
            return { ...oldData, data: { ...oldData.data, data: updated } }
          }
          return { ...oldData, data: updated }
        }
      )
    },
    [queryClient]
  )

  const removeBookmarkFromCache = useCallback(
    (id: string) => {
      queryClient.setQueriesData(
        { queryKey: ["infinite", "/v1/bookmarks"] },
        (oldData: any) => {
          if (!oldData?.pages) return oldData
          return {
            ...oldData,
            pages: oldData.pages.map((page: any) => {
              const currentItems = page?.data?.data
              if (!Array.isArray(currentItems)) return page
              return {
                ...page,
                data: {
                  ...page.data,
                  data: currentItems.filter((b: any) => b.id !== id),
                  totalCount: Math.max(0, (page.data?.totalCount || 1) - 1),
                },
              }
            }),
          }
        }
      )
      queryClient.setQueriesData(
        { queryKey: ["/v1/bookmarks"] },
        (oldData: any) => {
          if (!oldData) return oldData
          const dataArray = oldData.data?.data || oldData.data
          if (!Array.isArray(dataArray)) return oldData
          const filtered = dataArray.filter((b: any) => b.id !== id)
          if (oldData.data?.data) {
            return {
              ...oldData,
              data: {
                ...oldData.data,
                data: filtered,
                totalCount: Math.max(0, (oldData.data?.totalCount || 1) - 1),
              },
            }
          }
          return { ...oldData, data: filtered }
        }
      )
    },
    [queryClient]
  )

  return {
    updateBookmarkInCache,
    removeBookmarkFromCache,
  }
}

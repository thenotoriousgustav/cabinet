"use client"

import {
  AXIOS_INSTANCE,
  cabinetMediaApi as sharedCabinetMediaApi,
  type DownloadMediaPayload,
} from "@cabinet/api-client"

export {
  AXIOS_INSTANCE,
  useBookmarksControllerCleanDuplicates,
  useBookmarksControllerBulkAddTags,
  useBookmarksControllerCreate,
  useBookmarksControllerFindAll,
  useBookmarksControllerFindAllInfinite,
  useBookmarksControllerGetDuplicates,
  useBookmarksControllerGetHealthSummary,
  useBookmarksControllerImport,
  useBookmarksControllerExportBookmarks,
  useBookmarksControllerRemove,
  useBookmarksControllerReorder,
  useBookmarksControllerTriggerHealthCheck,
  useBookmarksControllerUpdate,
  useFoldersControllerCreate,
  useFoldersControllerFindAll,
  useFoldersControllerRemove,
  useFoldersControllerUpdate,
  useTagsControllerFindAll,
  useTagsControllerRemove,
  useUploadsControllerUpload,
  useUploadsControllerUploadBookmark,
} from "@cabinet/api-client"
export type { MediaFormat, MediaInfo } from "@cabinet/api-client"

export const cabinetMediaApi = {
  ...sharedCabinetMediaApi,
  download: async (payload: DownloadMediaPayload): Promise<void> => {
    const blob = await sharedCabinetMediaApi.download(payload)
    const downloadUrl = URL.createObjectURL(blob)
    const link = document.createElement("a")
    const extension = payload.mediaType === "AUDIO" ? "mp3" : "mp4"
    const title = payload.title.replace(/[^\w\s-]/gi, "").trim() || "download"
    try {
      link.href = downloadUrl
      link.download = `${title}.${extension}`
      document.body.appendChild(link)
      link.click()
    } finally {
      link.remove()
      URL.revokeObjectURL(downloadUrl)
    }
  },
}

export async function uploadFileToR2(file: File) {
  const formData = new FormData()
  formData.append("file", file)
  const response = await AXIOS_INSTANCE.post("/v1/uploads", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  })
  return (response.data.data ?? response.data) as {
    url: string
    key: string
    filename: string
    contentType: string
    size: number
  }
}

export async function uploadBookmarkToR2(params: {
  file: File
  title?: string
  description?: string
  folderId?: string
  tags?: string[]
}) {
  const formData = new FormData()
  formData.append("file", params.file)
  if (params.title?.trim()) formData.append("title", params.title.trim())
  if (params.description?.trim()) formData.append("description", params.description.trim())
  if (params.folderId) formData.append("folderId", params.folderId)
  if (params.tags?.length) formData.append("tags", params.tags.join(","))

  const response = await AXIOS_INSTANCE.post("/v1/uploads/bookmark", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  })
  return response.data.data ?? response.data
}

AXIOS_INSTANCE.defaults.baseURL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"
AXIOS_INSTANCE.defaults.withCredentials = true

AXIOS_INSTANCE.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/login")
    ) {
      window.location.assign("/login")
    }
    return Promise.reject(error)
  }
)

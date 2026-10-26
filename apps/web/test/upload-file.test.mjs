import assert from "node:assert/strict"
import test from "node:test"
import { uploadFileToR2, uploadBookmarkToR2, AXIOS_INSTANCE } from "../src/lib/api-client.ts"

test("uploadFileToR2 sends multipart form data with file to /v1/uploads", async () => {
  const originalPost = AXIOS_INSTANCE.post
  let requestedUrl = ""
  let requestedData = null
  let requestedHeaders = null

  AXIOS_INSTANCE.post = (async (url, data, config) => {
    requestedUrl = url
    requestedData = data
    requestedHeaders = config?.headers
    return {
      data: {
        success: true,
        data: {
          url: "https://pub.example.r2.dev/uploads/u1/test.pdf",
          key: "uploads/u1/test.pdf",
          filename: "test.pdf",
          contentType: "application/pdf",
          size: 1024,
        },
      },
    }
  })

  try {
    const file = new File(["dummy pdf content"], "test.pdf", { type: "application/pdf" })
    const result = await uploadFileToR2(file)
    assert.equal(requestedUrl, "/v1/uploads")
    assert.equal(requestedHeaders?.["Content-Type"], "multipart/form-data")
    assert.equal(requestedData?.get("file"), file)
    assert.equal(result.url, "https://pub.example.r2.dev/uploads/u1/test.pdf")
  } finally {
    AXIOS_INSTANCE.post = originalPost
  }
})

test("uploadBookmarkToR2 sends multipart form data with bookmark fields to /v1/uploads/bookmark", async () => {
  const originalPost = AXIOS_INSTANCE.post
  let requestedUrl = ""
  let requestedData = null

  AXIOS_INSTANCE.post = (async (url, data) => {
    requestedUrl = url
    requestedData = data
    return {
      data: {
        success: true,
        data: {
          id: "bm-upload-1",
          url: "https://pub.example.r2.dev/uploads/u1/doc.pdf",
          title: "My Custom Title",
        },
      },
    }
  })

  try {
    const file = new File(["dummy content"], "doc.pdf", { type: "application/pdf" })
    const result = await uploadBookmarkToR2({
      file,
      title: "My Custom Title",
      description: "A description",
      folderId: "folder-123",
      tags: ["research", "pdf"],
    })

    assert.equal(requestedUrl, "/v1/uploads/bookmark")
    assert.equal(requestedData?.get("file"), file)
    assert.equal(requestedData?.get("title"), "My Custom Title")
    assert.equal(requestedData?.get("description"), "A description")
    assert.equal(requestedData?.get("folderId"), "folder-123")
    assert.equal(requestedData?.get("tags"), "research,pdf")
    assert.equal(result.id, "bm-upload-1")
  } finally {
    AXIOS_INSTANCE.post = originalPost
  }
})

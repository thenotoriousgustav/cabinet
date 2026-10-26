import assert from "node:assert/strict"
import test from "node:test"
import { uploadBookmarkToR2, AXIOS_INSTANCE } from "../src/lib/api-client.ts"

test("finder file upload sends PDF to R2 and sets destination folder", async () => {
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
          id: "bm-pdf-1",
          url: "https://pub.example.r2.dev/uploads/u1/contract.pdf",
          title: "contract.pdf",
          contentType: "PDF",
        },
      },
    }
  })

  try {
    const pdfFile = new File(["%PDF-1.4 sample"], "contract.pdf", { type: "application/pdf" })
    const result = await uploadBookmarkToR2({
      file: pdfFile,
      folderId: "folder-work",
    })

    assert.equal(requestedUrl, "/v1/uploads/bookmark")
    assert.equal(requestedData?.get("file"), pdfFile)
    assert.equal(requestedData?.get("folderId"), "folder-work")
    assert.equal(result.id, "bm-pdf-1")
    assert.equal(result.contentType, "PDF")
  } finally {
    AXIOS_INSTANCE.post = originalPost
  }
})

test("finder file upload sends Image (PNG/JPEG) to R2", async () => {
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
          id: "bm-img-1",
          url: "https://pub.example.r2.dev/uploads/u1/photo.png",
          imageUrl: "https://pub.example.r2.dev/uploads/u1/photo.png",
          title: "photo.png",
          contentType: "IMAGE",
        },
      },
    }
  })

  try {
    const imgFile = new File(["fake-image-bytes"], "photo.png", { type: "image/png" })
    const result = await uploadBookmarkToR2({
      file: imgFile,
    })

    assert.equal(requestedUrl, "/v1/uploads/bookmark")
    assert.equal(requestedData?.get("file"), imgFile)
    assert.equal(result.contentType, "IMAGE")
  } finally {
    AXIOS_INSTANCE.post = originalPost
  }
})

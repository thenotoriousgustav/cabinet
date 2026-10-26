import type { NoteSnapshot } from "./note-autosave"

/** Finish an uncertain write before newer typing. Every retry carries the same revision and UUID. */
export class VersionedNoteSave {
  revision: number
  private attempt: { snapshot: NoteSnapshot; saveId: string; baseRevision: number } | null = null
  private send: (body: NoteSnapshot & { saveId: string; baseRevision: number }) => Promise<{ noteRevision: number }>
  constructor(revision: number, send: (body: NoteSnapshot & { saveId: string; baseRevision: number }) => Promise<{ noteRevision: number }>) {
    this.revision = revision
    this.send = send
  }
  async save(snapshot: NoteSnapshot) {
    if (this.attempt) {
      const previous = this.attempt.snapshot
      await this.commit()
      if (previous === snapshot) return
    }
    this.attempt = { snapshot, saveId: crypto.randomUUID(), baseRevision: this.revision }
    await this.commit()
  }
  private async commit() {
    const attempt = this.attempt!
    try {
      const result = await this.send({ ...attempt.snapshot, saveId: attempt.saveId, baseRevision: attempt.baseRevision })
      this.revision = result.noteRevision
      this.attempt = null
    } catch (error: any) {
      const status = error.response?.status
      if (status >= 400 && status < 500 && ![408, 409, 429].includes(status)) this.attempt = null
      throw error
    }
  }
  rebase(revision: number) {
    this.revision = revision
    this.attempt = null
  }
}

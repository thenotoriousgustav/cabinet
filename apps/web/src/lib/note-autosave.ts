export interface NoteSnapshot {
  folderId?: string
  /** Undefined leaves the saved tags untouched (older local drafts have none). */
  tags?: string[]
  title: string
  notes: string
  noteDocument: Record<string, any>
}

export type NoteSaveStatus = "saved" | "unsaved" | "saving" | "error" | "offline" | "conflict"

/** Serializes writes so an older request cannot overwrite more recent typing. */
export class NoteAutosave<T extends object = NoteSnapshot> {
  private pending: T | null = null
  private inFlight: Promise<boolean> | null = null
  private timer: ReturnType<typeof setTimeout> | undefined

  private save: (snapshot: T) => Promise<void>
  private status: (status: NoteSaveStatus) => void
  private delay: number
  private blocked = false
  private disposed = false
  private failures = 0
  private retry: boolean

  constructor(
    save: (snapshot: T) => Promise<void>,
    status: (status: NoteSaveStatus) => void,
    delay = 800,
    options: { retry?: boolean } = {}
  ) {
    this.save = save
    this.status = status
    this.delay = delay
    this.retry = options.retry ?? false
  }

  get hasUnsavedChanges() {
    return this.pending !== null || this.inFlight !== null
  }

  schedule(snapshot: T) {
    this.pending = snapshot
    if (this.blocked) return
    this.status("unsaved")
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.flush()
    }, this.delay)
  }

  flush(): Promise<boolean> {
    clearTimeout(this.timer)
    if (this.blocked || this.disposed) return Promise.resolve(false)
    if (this.inFlight) return this.inFlight
    this.inFlight = this.drain().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async drain() {
    while (this.pending) {
      const snapshot = this.pending
      this.pending = null
      this.status("saving")
      try {
        await this.save(snapshot)
        this.failures = 0
      } catch (error: any) {
        this.pending ??= snapshot
        const code = error.response?.status
        if (code === 409) {
          this.blocked = true
          this.status("conflict")
        } else if (this.retry && (!code || code >= 500 || code === 429 || code === 408)) {
          this.status("offline")
          if (!this.disposed) this.timer = setTimeout(() => void this.flush(), Math.min(30000, 1000 * 2 ** this.failures++))
        } else this.status("error")
        return false
      }
    }
    this.status("saved")
    return true
  }

  resume() {
    this.blocked = false
    return this.flush()
  }

  dispose() {
    this.disposed = true
    clearTimeout(this.timer)
  }
}

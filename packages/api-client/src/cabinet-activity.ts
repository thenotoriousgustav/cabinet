export interface ActivityOverview {
  pending: number
  running: number
  failed: number
  completed: number
  onboarding: { dismissed: boolean; savedLink: boolean; organized: boolean; extensionSaved: boolean }
}
export interface BackgroundTask {
  id: string
  kind: "IMPORT" | "LINK_CHECK"
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"
  total: number
  processed: number
  failed: number
  attempt: number
  error: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}
export interface MetadataActivity {
  id: string; title: string; url: string; metadataStatus: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"
  metadataError: string | null; updatedAt: string; lastEnrichedAt: string | null
}
export interface CabinetActivity { summary: ActivityOverview; tasks: BackgroundTask[]; metadata: MetadataActivity[]; page: number; hasMore: boolean }
export interface LatencyMeasurement {
  name: string; count: number; errors: number; samples: number; p50Ms: number | null; p95Ms: number | null; maxMs: number | null
}
export interface OperationsMetrics {
  startedAt: string; measuredAt: string; uptimeSeconds: number
  memoryBytes: { rss: number; heapUsed: number; heapTotal: number; external: number }
  cpuTotalMicros: number
  cpuPercent: number | null; eventLoop: { meanMs: number | null; p95Ms: number | null }
  routes: LatencyMeasurement[]; queries: LatencyMeasurement[]
  jobs: { tasks: Record<string, number>; metadata: Record<string, number> }
  sampling: string
}

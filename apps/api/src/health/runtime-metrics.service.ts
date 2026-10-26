import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common"
import { monitorEventLoopDelay } from "node:perf_hooks"

export class DurationWindow {
  private values: number[] = []
  private index = 0
  count = 0
  errors = 0
  observe(milliseconds: number, failed = false) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return
    this.count++; if (failed) this.errors++
    if (this.values.length < 512) this.values.push(milliseconds)
    else { this.values[this.index] = milliseconds; this.index = (this.index + 1) % 512 }
  }
  snapshot() {
    const values = [...this.values].sort((a, b) => a - b)
    const percentile = (p: number) => values.length ? Math.round(values[Math.max(0, Math.ceil(values.length * p) - 1)] * 100) / 100 : null
    return { count: this.count, errors: this.errors, samples: values.length, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: values.length ? values.at(-1)! : null }
  }
}

@Injectable()
export class RuntimeMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly startedAt = new Date()
  private readonly routes = new Map<string, DurationWindow>()
  private readonly queries = new Map<string, DurationWindow>()
  private readonly loop = monitorEventLoopDelay({ resolution: 20 })
  private timer?: ReturnType<typeof setInterval>
  private lastCpu = process.cpuUsage()
  private lastTime = process.hrtime.bigint()
  private cpuPercent: number | null = null
  onModuleInit() {
    this.loop.enable()
    this.timer = setInterval(() => {
      const now = process.hrtime.bigint(), cpu = process.cpuUsage(), elapsed = Number(now - this.lastTime) / 1000
      this.cpuPercent = Math.round(((cpu.user - this.lastCpu.user + cpu.system - this.lastCpu.system) / elapsed) * 10000) / 100
      this.lastCpu = cpu; this.lastTime = now
    }, 5000)
    this.timer.unref()
  }
  onModuleDestroy() { clearInterval(this.timer); this.loop.disable() }
  private observe(map: Map<string, DurationWindow>, key: string, ms: number, failed = false) {
    if (!map.has(key) && map.size >= 100) key = "other"
    const window = map.get(key) ?? new DurationWindow()
    window.observe(ms, failed); map.set(key, window)
  }
  request(route: string, ms: number, failed = false) { this.observe(this.routes, route, ms, failed) }
  query(shape: string, ms: number) { this.observe(this.queries, safeQueryShape(shape), ms) }
  snapshot() {
    const memory = process.memoryUsage(), cpu = process.cpuUsage()
    const summarize = (map: Map<string, DurationWindow>) => [...map].map(([name, value]) => ({ name, ...value.snapshot() })).sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0))
    return {
      startedAt: this.startedAt, measuredAt: new Date(), uptimeSeconds: Math.floor(process.uptime()),
      cpuTotalMicros: cpu.user + cpu.system,
      memoryBytes: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external },
      cpuPercent: this.cpuPercent, eventLoop: { meanMs: Number.isFinite(this.loop.mean) ? Math.round(this.loop.mean / 1e4) / 100 : null, p95Ms: this.loop.count ? Math.round(this.loop.percentile(95) / 1e4) / 100 : null },
      routes: summarize(this.routes), queries: summarize(this.queries),
      sampling: "Latency percentiles use the last 512 samples per route/query group; counters reset when this API process restarts. CPU is relative to one core over the latest five-second interval.",
    }
  }
}

/** Only the command and table category survive. Never collect SQL parameters, literals, URLs or user IDs. */
export function safeQueryShape(sql: string) {
  const command = sql.trim().match(/^(SELECT|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|WITH)\b/i)?.[1]?.toUpperCase() ?? "OTHER"
  const table = sql.match(/(?:FROM|INTO|UPDATE|JOIN)\s+(?:"?public"?\.)?"?(bookmarks|folders|tags|background_tasks|users|auth_sessions|auth_accounts|folder_members)"?\b/i)?.[1]?.toLowerCase() ?? "other"
  return `${command} ${table}`
}

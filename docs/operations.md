# Background activity and server measurements

## Metadata: save first, enrich only when needed

Creating a bookmark now writes its URL and client metadata immediately; the request never fetches the target website. Database and Redis operations still take time—this is not an offline web dashboard.

- A supplied title, description, and preview image are enough to mark client metadata complete. A missing favicon or site name does not justify another website request.
- The updated extension also forwards a page-declared article/video content type. Known video URLs still take precedence.
- Otherwise, a background metadata job fills missing fields. It never replaces a nonempty description, image, favicon, or site name. Only a new, explicitly marked URL-placeholder title can be replaced; editing the title clears that marker.
- Worker writes include the original URL and active-item condition. Changing a URL or deleting a bookmark while a fetch is in flight cannot apply that fetch's metadata to the new URL/deleted item.
- Metadata HTML is streamed only up to a 1 MiB prefix, then the response is cancelled. Text previews and asset URLs are bounded too. This controls memory use, but unusual pages whose metadata appears after that prefix may not yield a complete preview.
- Stable BullMQ IDs (`metadata-<bookmark-id>`) deduplicate waiting/running jobs. Already completed or terminally failed items are not fetched again by stale jobs. Manual retry marks a failed item pending again.
- Recovery considers only unfinished web bookmarks, not notes, drawings, completed items without a cover, or every item with an empty description. A site can legitimately have no cover.

Website blocking is recorded as metadata failure without losing the bookmark or client-supplied fields. Exceptions use the queue's existing three-attempt exponential backoff. After terminal failure, the user can retry from Activity. Unfinished records survive Redis interruptions and are reconciled about once a minute.

## Activity

Open `/cabinet/activity`, the Activity link above the library, or Health → Activity in the sidebar. Activity is authenticated and scoped to the account that owns the work—not every contributor to a shared folder.

The page shows real database states, progress, failures, and retry controls. History is paginated in groups of 30 tasks and 30 metadata items needing work, so older failures remain reachable. The first page also includes ten recent metadata completions. It refreshes every three seconds while work is active and every thirty seconds otherwise. The library overview refreshes active work and invalidates library caches when its status counts change, so newly enriched previews appear without manually reloading the library.

### Import

`POST /v1/bookmarks/import` now responds **202 Accepted** with a persistent task object, not `{ imported: number }`. Both web import screens have been updated: they report that work was queued and link to Activity, rather than claiming an import finished before the worker ran.

- Browser uploads are limited to 1 MB. Server HTML content is limited to 1,000,000 characters and the existing 2 MB HTTP body limit. Split larger exports first.
- The importer accepts Netscape-style HTML, quoted attributes in any order, several entries on one line, nested folders, entities, and Unicode. It accepts HTTP(S) links only and reports skipped unsupported URLs.
- Each file may contain at most 10,000 folder/bookmark entries. Files with no supported bookmarks are rejected before queuing.
- Import content stays in the private `background_tasks.payload` database column; Redis receives only a task ID. API activity responses never return that content. Successful completion clears the payload. Failed tasks retain it so retry works; deleting the account cascades its tasks and payloads.
- A task's folder IDs and per-entry creation request IDs are stable. Retrying a partially completed import reuses those IDs rather than creating duplicate folders or links, and preserves already saved items.
- Progress is checkpointed every 25 bookmarks and at completion/interruption. Existing imported records are counted again as the retry verifies/reuses them. Metadata enrichment continues separately after import completion.
- Independent imports are independent operations: deliberately uploading the same file again after completion may create duplicate URLs. Use **Retry** on the original failed task, not a new upload, to resume partial work safely.
- An account has at most one active import and one active link check. A different file cannot silently replace an active import.

### Link checks

`POST /v1/bookmarks/health/check` responds **202 Accepted** with an account-scoped link-check task. Manual checks scan the requesting account's active web links in bounded pages, not the first 100 links across all users.

Daily scheduling creates separate tasks for accounts with unchecked/stale links; scheduled scans check only links due after 24 hours. The existing startup/daily schedule is retained, but work is now visible as tasks. HEAD requests have five-second timeouts and four-way bounded concurrency per check task. Targets and permanent redirect destinations use the same public-URL validation as metadata requests. URL-guarded updates do not replace a link edited concurrently.

Access restrictions, rate limits, timeouts, network failures, and unavailable servers are inconclusive (`UNKNOWN`), not proof of a broken link. Genuine missing pages such as HTTP 404 are still broken. A scan can complete successfully while reporting broken or inconclusive links.

### Durable states and recovery

Tasks move `PENDING → RUNNING → COMPLETED`; retryable exceptions return to `PENDING`, and exhausted attempts become `FAILED`. Manual retry claims the active account/type slot and restarts the same task. Attempt numbers fence stale progress/completion writes. Startup-recovered or stalled jobs cannot overwrite a newer attempt's status.

Task recovery runs about every thirty seconds. Metadata recovery runs about every sixty seconds. Each recovery pass is bounded to 100 records; large backlogs and worker locks can take longer than one interval to drain. Queue outages leave durable pending records and a visible explanation rather than falsely reporting completion. Normal failures do not erase saved data. Workers currently run inside the NestJS API process: two import/link-check jobs and three metadata jobs concurrently. Test mode disables periodic schedulers/recovery, not worker processing.

## First-use guidance

The library offers three concrete steps: save a link, organize an item with a folder/tag, and save a page/highlight using the extension. The organization action opens real item/tag controls; merely opening controls does not complete a step.

Completion is derived from account data. Opening an extension guide or clicking a button is not treated as an installed extension or a successful save. Extension progress is recorded only after a save from the updated extension reaches the API. Historical saves made before source tracking cannot be reliably identified as extension saves.

Dismissal is saved per account and can be undone from Activity. All three steps completing hides the guide automatically; the extension guide remains available afterward. On a phone, the guide shows the next unfinished step rather than occupying the whole screen with three panels. The extension setup guide explicitly describes the current unpacked installation process; it does not link to a nonexistent Chrome Web Store listing.

## Operator-only measurements

Set the API environment variable, then restart the API:

```dotenv
# Comma-separated User UUIDs; blank disables access for everyone.
OPERATIONS_USER_IDS="your-operator-user-uuid"
```

This is an explicit server-side allowlist, not an inferred role based on an email address or a client preference. The authenticated `/v1/operations/access` route exposes only the caller's capability. `/v1/operations/metrics` rejects other accounts with 403 and uses `private, no-store`. Authorized users can open `/cabinet/operations` from Activity.

Measurements include:

- Process RSS, JavaScript heap, and external-memory bytes. RSS includes native allocations. These are **API-process measurements only**, not PostgreSQL, Redis, Next.js, or `yt-dlp` child-process memory.
- CPU relative to one core over the latest five-second interval; values above 100% are possible with multiple busy native threads. A cumulative CPU-time counter supports stage-average profiling of short bursts.
- Event-loop delay since process start.
- API count, server-error count, p50/p95/max latency per route pattern, with library search measured separately. Request paths/IDs, search terms, cookies, and bodies are not retained.
- Prisma query count and p50/p95/max grouped by SQL command and a table allowlist. SQL text, SQL parameters, literals, and personal content are discarded immediately. These groups identify areas to investigate; they are not stored query plans or a full tracing/APM system.
- Database counts for waiting/running/failed/completed background work across accounts, visible to operators only.

Latency storage is bounded to 512 samples per group and 100 named route/query groups plus an overflow bucket. Counts reset when the process restarts. Metrics are process-local, so separate replicas have separate snapshots; they are not fleet-wide telemetry. No third-party monitoring service is contacted. The operator UI refreshes every five seconds and labels its sampling limits.

## Repeatable local baseline

After migrations and an API build:

```bash
(cd apps/api && node --env-file=.env test/profile.integration.mjs ../../docs/performance-baseline.json)
```

The development PostgreSQL role needs `CREATEDB` permission. The script creates a temporary database, applies the project's migrations there, creates two test users with valid signed sessions, and starts a compiled API on port 4243 against that database and a unique Redis prefix. OAuth/password configuration is unchanged, and `NODE_ENV=production` is refused. Normal completion/errors drop only that generated database and clear only that Redis namespace in `finally`; the configured source database is not a benchmark target and is never reset. Redis is never flushed. A forcibly killed test process may need its generated test database cleaned up manually.

The partial-import retry integration check uses the same temporary-database isolation. This matters because a Redis prefix alone does not stop another API's recovery sweep from seeing unfinished rows in a shared database.

The fixture has 1,000 bookmarks, an idle interval long enough to exclude the first CPU sample, three read/search workloads (80 measured requests each, concurrency four), and a 500-bookmark import for active-worker samples. It also checks metrics authorization, task privacy, payload removal, import progress, and genuine extension-save onboarding.

`docs/performance-baseline.json` contains the actual latest local run: client-side p50/p95/throughput, process memory, stage-average CPU, observed worker-load samples, and server measurements. This is **not a before/after optimization claim or a production capacity guarantee**. Other local processes and shared PostgreSQL/Redis load influence results. Client durations include authentication, serialization, and local HTTP overhead; server/query measurements have different boundaries.

## Deployment and checks

Apply the additive migrations before the new API, rebuild the API client/web app, restart services, and reload the updated extension. Older bookmark-create clients still work, but an updated extension sends new `source`/`contentType` fields and therefore needs the new API first.

```bash
pnpm --filter @cabinet/api exec prisma migrate deploy
pnpm --filter @cabinet/api build
pnpm --filter @cabinet/api-client generate
pnpm --filter @cabinet/api-client build
pnpm --filter @cabinet/web build
pnpm --filter @cabinet/api exec jest --runInBand
(cd apps/api && node --env-file=.env test/background-retry.integration.mjs)
pnpm --filter @cabinet/web test
pnpm --filter @cabinet/extension test
# With the web service running; all browser API responses below are explicit fixtures:
node apps/web/test/activity.browser.mjs
node apps/web/test/search-and-sync.browser.mjs
node apps/extension/test/popup.browser.mjs
```

`BULLMQ_PREFIX` defaults to `bull` to preserve existing queues. Use a unique prefix **and a separate database** for isolated test deployments sharing Redis. All replicas sharing one database must use the same queue prefix; different prefixes alone do not isolate database-backed recovery. Do not change a live deployment's prefix casually. Pending work with no progress usually means the worker/Redis connection needs attention. Activity shows persisted state and queue-recovery errors; it does not pretend that a queued task has finished.

# Running Cabinet

Cabinet is one application for bookmarks, notes, and saved reading. Its Next.js frontend and NestJS API run as separate services.

## Requirements

- Node.js 22.13+
- pnpm 11+
- PostgreSQL and Redis, or Docker Compose

## Setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm db:up
pnpm --filter @cabinet/api prisma:generate
pnpm --filter @cabinet/api prisma:migrate
pnpm --filter @cabinet/api prisma:seed
pnpm dev
```

Configure `apps/api/.env` before running migrations. Generate `BETTER_AUTH_SECRET` with `openssl rand -hex 32` and set it before starting the API. Docker uses the username `postgres` and password `postgrespassword`.

The database retains its existing name, `atlas`, to preserve compatibility with existing data. Do not reset the database or remove Docker volumes for this rename.

## Services

- Cabinet: http://localhost:3000
- API: http://localhost:4000
- API documentation: http://localhost:4000/api/docs

Run services separately:

```bash
pnpm --filter @cabinet/api dev
pnpm --filter @cabinet/web dev
```

Set `NEXT_PUBLIC_API_URL` in `apps/web/.env.local` when the API is not at `http://localhost:4000`.

## Link previews (WhatsApp and social apps)

Set the public **frontend** origin in `apps/web/.env.local` or your deployment's build environment before building:

```dotenv
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

Replace the example with your real HTTPS domain, then rebuild and redeploy. Without this setting, metadata uses `http://localhost:3000` for local development only. WhatsApp cannot fetch localhost URLs.

The root layout provides Open Graph metadata and a large-image Twitter card. `apps/web/src/app/opengraph-image.tsx` generates the shared 1200 × 630 PNG at `/opengraph-image`; edit that file to change its design. All routes use generic Cabinet branding, never private notes or bookmark contents.

The shared page and image must be publicly reachable without login, deployment protection, or bot challenges. This does not make library data public. Test by pasting the deployed homepage URL into WhatsApp and waiting for the preview before sending. Messaging apps may cache old previews and control the final card layout; exact rendering is not guaranteed.

Optional local smoke check, with the web server running:

```bash
node apps/web/test/link-preview.smoke.mjs http://localhost:3000
```

## Development login

The seed script defaults to `admin@gustam.dev` / `password123`. Override `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME` in `apps/api/.env`. Use strong credentials outside local development. The seed updates only that account and its Better Auth password credential; it never deletes other users.

## GitHub and Google sign-in

Configure these values in `apps/api/.env`:

```dotenv
BETTER_AUTH_SECRET=your-unique-random-secret-of-at-least-32-characters
FRONTEND_URL=http://localhost:3000
API_URL=http://localhost:4000
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

Register a GitHub OAuth App and a Google OAuth client of type **Web application**. Set their callback URLs to:

- GitHub: `http://localhost:4000/v1/auth/callback/github`
- Google: `http://localhost:4000/v1/auth/callback/google`

Use your public API URL for production callbacks. Use HTTPS in production. Keep client secrets on the API server; never put them in `NEXT_PUBLIC_*` variables. Google apps in testing mode permit only configured test users; publish the consent screen to allow general access.

Apply the new migration before starting the API:

```bash
pnpm --filter @cabinet/api exec prisma migrate deploy
pnpm --filter @cabinet/api prisma:generate
pnpm dev
```

## Cloudflare R2 Storage (PDF & Image Uploads)

Configure Cloudflare R2 credentials in `apps/api/.env`:

```dotenv
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET_NAME=cabinet
# Optional: custom domain or r2.dev public URL; falls back to API streaming if omitted
R2_PUBLIC_URL=https://pub-xxx.r2.dev
```

Better Auth runs in the NestJS API at `/v1/auth`, backed by Prisma and database sessions. Generate `BETTER_AUTH_SECRET` using `openssl rand -hex 32`. For a deployment such as `app.cabinet.com` and `api.cabinet.com`, set `COOKIE_DOMAIN=.cabinet.com` and the exact frontend and API URLs. Leave cross-domain cookies disabled on localhost.

New GitHub and Google users receive separate Cabinet accounts. Both providers require a verified email. Email/password sign-in remains available to accounts with a password; new email/password registration is disabled. Better Auth verifies the existing Argon2 hashes, so users do not need to reset their passwords.

When a verified Google or GitHub email matches an existing Cabinet account, Better Auth automatically links that provider to the existing user. It never merges or deletes user records. Only verified Google and GitHub identities are trusted for automatic linking.

Passkey login and registration remain disabled. The Better Auth migration preserves user IDs, bookmarks, password hashes, OAuth identities, and all legacy authentication records. Existing JWT sessions are no longer accepted; users need to sign in again. Password changes use Better Auth's `changePassword` API rather than the profile endpoint. Profile updates accept only `name` and `avatar`.

Run the authentication integration check against the development database after applying migrations. It starts a temporary API on port 4141, checks password login, cookie sessions, protected routes, signup restrictions, origin checks, profile updates, and logout, then removes only its own temporary user:

```bash
pnpm --filter @cabinet/api test:auth
```

## Activity and performance measurements

Apply migrations before starting the updated API. The library's Activity link opens persistent import/link-check progress, metadata failures, and retry actions at `/cabinet/activity`. Imports now return an accepted task instead of a synchronous imported count.

Set `OPERATIONS_USER_IDS` to a comma-separated list of operator User UUIDs in the API environment and restart the API to enable `/cabinet/operations` for those accounts. It is disabled for everyone by default. Never put this setting in `NEXT_PUBLIC_*` variables. The measurements are API-process-local, not total deployment memory.

Read [operations.md](./operations.md) for complete semantics and checks. To produce a real local baseline with isolated test accounts and Redis queues:

```bash
pnpm --filter @cabinet/api build
(cd apps/api && node --env-file=.env test/profile.integration.mjs ../../docs/performance-baseline.json)
(cd apps/api && node --env-file=.env test/background-retry.integration.mjs)
```

The profiling script uses port 4243 and requires development PostgreSQL/Redis with a PostgreSQL role allowed to create databases. It creates/migrates a temporary database and a separate Redis namespace, then removes only those resources. The configured source database is not used for the benchmark workload. The retry integration check uses the same database isolation. Output is a local baseline, not a production capacity guarantee or a before/after claim.

## API client

The API writes `apps/api/openapi.json` on startup. After changing endpoints, regenerate and build the client:

```bash
pnpm --filter @cabinet/api-client generate
pnpm --filter @cabinet/api-client build
```

## Search and resilient-save checks

After applying migrations and building the API:

```bash
pnpm --filter @cabinet/api exec jest --runInBand
(cd apps/api && node --env-file=.env test/search-and-saves.integration.mjs)
pnpm --filter @cabinet/web test
pnpm --filter @cabinet/extension test
node apps/extension/test/popup.browser.mjs
# With the web dev server running (uses mocked API fixtures, not a real account):
node apps/web/test/search-and-sync.browser.mjs
```

The database integration check creates isolated temporary users and removes only their data. It covers ranking, typos, filters, cursor pagination, shared-data privacy, saved-search ownership, concurrent idempotent creates, and note revision conflicts. Browser checks cover queued extension saves, popup reopening, lost acknowledgements, note reconnection, and two-tab conflict resolution.

## UI components

Web UI components live in `apps/web/src/components/ui`:

```bash
cd apps/web
pnpm exec shadcn add <component-name>
```

Import components through `@/components/ui/<component-name>`. Styling lives in `apps/web/src/app/globals.css`.

## Shared code and future mobile clients

`packages/api-client` contains API endpoints, generated query hooks, types, and a configurable Axios instance. It does not set browser cookies or redirect pages. Each client configures `AXIOS_INSTANCE.defaults.baseURL` and its own authentication policy.

Web code imports `@/lib/api-client`, which configures cookie requests, redirects after expired sessions, and browser file downloads. Authentication uses `@/lib/auth-client` and Better Auth's browser client; there is no custom JWT refresh flow or separate auth store. Future React Native code imports `@cabinet/api-client` directly and configures native authentication separately. This change does not implement mobile token storage or a native login flow.

ESLint and TypeScript configuration remain shared in `packages/eslint-config` and `packages/typescript-config`.

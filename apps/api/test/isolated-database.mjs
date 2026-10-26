import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import pg from "pg"

/** Isolate recovery sweeps too: a Redis prefix alone cannot isolate rows in a shared database. */
export async function isolatedDatabase(label) {
  if (!process.env.DATABASE_URL || process.env.NODE_ENV === "production") throw new Error("Use a local development PostgreSQL connection with CREATEDB permission")
  if (!/^[a-z]+$/.test(label)) throw new Error("Invalid test database label")
  const name = `cabinet_${label}_${randomUUID().replaceAll("-", "")}`
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 })
  await admin.connect()
  let created = false, closed = false
  const cleanup = async () => {
    if (closed) return
    closed = true
    try {
      if (created) {
        await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [name])
        await admin.query(`DROP DATABASE "${name}"`)
      }
    } finally { await admin.end() }
  }
  try {
    await admin.query(`CREATE DATABASE "${name}"`)
    created = true
    const url = new URL(process.env.DATABASE_URL)
    url.pathname = `/${name}`
    url.searchParams.set("schema", "public")
    const migration = spawn("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)), env: { ...process.env, DATABASE_URL: url.href }, stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    migration.stdout.on("data", (chunk) => { output = (output + chunk).slice(-20000) })
    migration.stderr.on("data", (chunk) => { output = (output + chunk).slice(-20000) })
    await new Promise((resolve, reject) => {
      migration.on("error", reject)
      migration.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Test database migration failed: ${output}`)))
    })
    return { url: url.href, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

// Aplica las migraciones de supabase/migrations/ a la base OlivosSpeed.
//
// Uso (dos formas de conectarse, mismas garantías):
//   node scripts/migrate.mjs --via-cli --dry-run     # por el CLI de Supabase (API de gestión)
//   node scripts/migrate.mjs --via-cli               #   no necesita la contraseña de Postgres
//   node --env-file=.env.local scripts/migrate.mjs   # por conexión directa (SUPABASE_DB_URL)
//
// Garantías (el migrate.mjs de otros proyectos rompe si se corre dos veces):
//   · Registra cada migración aplicada en `cos_schema_migrations` y no la repite.
//   · Cada migración corre en UNA transacción junto con su registro: o entra entera o nada.
//   · Guarda el sha256 de cada archivo: si alguien edita una migración YA aplicada,
//     se niega a seguir (las aplicadas no se tocan: se agrega una nueva).
//   · Solo corre contra OlivosSpeed.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const OLIVOSSPEED_REF = "jhftgcjiymjcamjikuwe"
const dryRun = process.argv.includes("--dry-run")
const viaCli = process.argv.includes("--via-cli")

const __dirname = dirname(fileURLToPath(import.meta.url))
const migDir = join(__dirname, "..", "supabase", "migrations")
const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()
const sha = (s) => createHash("sha256").update(s).digest("hex")
const lit = (s) => `'${String(s).replaceAll("'", "''")}'` // literal SQL seguro para nombre y hash

const TRACKING_DDL = `
  create table if not exists public.cos_schema_migrations (
    filename   text primary key,
    sha256     text not null,
    applied_at timestamptz not null default now()
  );
  alter table public.cos_schema_migrations enable row level security;
  revoke all on public.cos_schema_migrations from anon, authenticated;
`

// ── Conexión ────────────────────────────────────────────────────────────────
async function connect() {
  if (viaCli) {
    const tmp = mkdtempSync(join(tmpdir(), "cos-migrate-"))
    let n = 0
    return {
      label: `CLI de Supabase → proyecto ${OLIVOSSPEED_REF}`,
      async query(sql) {
        const f = join(tmp, `q${n++}.sql`)
        writeFileSync(f, sql)
        const out = execFileSync(
          "supabase",
          ["db", "query", "--linked", "--project-ref", OLIVOSSPEED_REF, "-f", f, "--output-format", "json"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 },
        )
        const j = JSON.parse(out)
        if (j._tag === "Error" || j.error) throw new Error(JSON.stringify(j.error ?? j))
        return j.rows ?? []
      },
      async end() {
        rmSync(tmp, { recursive: true, force: true })
      },
    }
  }

  const url = process.env.SUPABASE_DB_URL
  if (!url) throw new Error("Falta SUPABASE_DB_URL (o usá --via-cli)")
  if (!url.includes(OLIVOSSPEED_REF)) throw new Error(`SUPABASE_DB_URL no apunta a OlivosSpeed (${OLIVOSSPEED_REF})`)
  const { default: pg } = await import("pg")
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  return {
    label: "conexión directa (SUPABASE_DB_URL)",
    async query(sql) {
      const r = await client.query(sql)
      const last = Array.isArray(r) ? r[r.length - 1] : r
      return last?.rows ?? []
    },
    end: () => client.end(),
  }
}

// ── Ejecución ───────────────────────────────────────────────────────────────
const db = await connect()
console.log(`Conectado por ${db.label}`)
try {
  await db.query(TRACKING_DDL)
  const rows = await db.query("select filename, sha256 from public.cos_schema_migrations order by filename")
  const applied = new Map(rows.map((r) => [r.filename, r.sha256]))

  const pending = []
  for (const f of files) {
    const sql = readFileSync(join(migDir, f), "utf8")
    const h = sha(sql)
    if (applied.has(f)) {
      if (applied.get(f) !== h) {
        console.error(`✗ ${f} ya estaba aplicada pero el archivo CAMBIÓ. Las migraciones aplicadas no se editan: creá una nueva.`)
        process.exit(1)
      }
      console.log(`· ${f} (ya aplicada)`)
    } else {
      pending.push({ f, sql, h })
    }
  }

  if (pending.length === 0) {
    console.log("✓ No hay migraciones pendientes.")
  } else if (dryRun) {
    console.log(`\nSe aplicarían ${pending.length}: ${pending.map((p) => p.f).join(", ")}`)
    console.log("(--dry-run: no se tocó nada)")
  } else {
    for (const { f, sql, h } of pending) {
      process.stdout.write(`→ ${f} … `)
      // Migración + su registro en una sola transacción.
      const tx = `begin;\n${sql}\n;\ninsert into public.cos_schema_migrations (filename, sha256) values (${lit(f)}, ${lit(h)});\ncommit;\n`
      try {
        await db.query(tx)
        console.log("OK")
      } catch (e) {
        console.log("FALLÓ (no se aplicó nada de este archivo)")
        throw e
      }
    }
    console.log("✓ Migraciones aplicadas.")
  }
} finally {
  await db.end()
}

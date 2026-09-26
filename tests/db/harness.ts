/**
 * Arnés de pruebas de la base: un Postgres real (PGlite, en memoria) con lo mínimo
 * que Supabase trae de fábrica (esquema `auth`, `auth.uid()` y los roles anon /
 * authenticated / service_role), y encima las MISMAS migraciones que van a producción.
 *
 * Así las reglas de seguridad de la base se prueban antes de acercarse a OlivosSpeed.
 */
import { PGlite, type PGliteInterface } from "@electric-sql/pglite"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations")

// Imitación mínima de lo que Supabase ya tiene creado en cada proyecto.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant select on auth.users to service_role;
`

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()
}

export type Db = PGliteInterface

let template: PGlite | null = null

/** Base nueva con Supabase simulado + todas las migraciones aplicadas. */
export async function freshDb(): Promise<Db> {
  if (!template) {
    template = new PGlite()
    await template.exec(SUPABASE_STUB)
    for (const f of migrationFiles()) {
      await template.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    }
  }
  // clone() copia la base ya migrada: cada test arranca limpio y rápido.
  return template.clone()
}

/** Corre SQL como otro rol (anon / authenticated / service_role), opcionalmente con un usuario. */
export async function asRole<T>(
  db: Db,
  role: "anon" | "authenticated" | "service_role",
  fn: () => Promise<T>,
  userId?: string,
): Promise<T> {
  await db.exec(`set role ${role}`)
  if (userId) await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId])
  try {
    return await fn()
  } finally {
    await db.exec(`reset role`)
    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}

export const JAVIER = "11111111-1111-4111-8111-111111111111"
export const EXTRANO = "22222222-2222-4222-8222-222222222222"

export async function crearUsuarios(db: Db) {
  await db.query(`insert into auth.users (id, email) values ($1, 'javier@test'), ($2, 'extrano@test')`, [
    JAVIER,
    EXTRANO,
  ])
}

type Row = Record<string, unknown>

export async function one<T extends Row = Row>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params)
  if (r.rows.length !== 1) throw new Error(`se esperaba 1 fila, hubo ${r.rows.length}: ${sql}`)
  return r.rows[0]
}

/** Arma un post de FasutoFudo en Instagram con una foto, listo para aprobar. */
export async function crearPostFasutofudo(db: Db, caption = "Tres onigiris, tres estilos 🍙") {
  const acc = await one<{ id: string; brand_id: string }>(
    db,
    `select a.id, a.brand_id from cos_social_accounts a join cos_brands b on b.id = a.brand_id
     where b.slug = 'fasutofudo' and a.platform = 'instagram'`,
  )
  const asset = await one<{ id: string }>(
    db,
    `insert into cos_assets (brand_id, source, source_external_id, description, status, media_type)
     values ($1, 'turnos', gen_random_uuid()::text, 'Caja con los 3 onigiris recién armados', 'READY', 'photo')
     returning id`,
    [acc.brand_id],
  )
  const version = await one<{ id: string }>(
    db,
    `insert into cos_asset_versions (asset_id, version_number, kind, drive_file_id)
     values ($1, 1, 'original', 'drive-file-1') returning id`,
    [asset.id],
  )
  const post = await one<{ id: string }>(
    db,
    `insert into cos_posts (brand_id, account_id, platform, post_type, caption, scheduled_at)
     values ($1, $2, 'instagram', 'feed', $3, '2026-09-29T22:30:00Z') returning id`,
    [acc.brand_id, acc.id, caption],
  )
  await db.query(`insert into cos_post_media (post_id, version_id, position) values ($1, $2, 0)`, [
    post.id,
    version.id,
  ])
  return { postId: post.id, accountId: acc.id, brandId: acc.brand_id, assetId: asset.id, versionId: version.id }
}

export async function estado(db: Db, postId: string) {
  return one<{ status: string; approved_hash: string | null; approved_by: string | null }>(
    db,
    `select status, approved_hash, approved_by from cos_posts where id = $1`,
    [postId],
  )
}

/**
 * Assets (descripción obligatoria, versiones inmutables), datos iniciales y configuración.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { type Db, freshDb, one } from "./harness"

let db: Db
let fasutoId: string
beforeEach(async () => {
  db = await freshDb()
  fasutoId = (await one<{ id: string }>(db, `select id from cos_brands where slug = 'fasutofudo'`)).id
})

const insertAsset = (desc: string | null, status: string, ext = "sub-1") =>
  db.query(
    `insert into cos_assets (brand_id, source, source_external_id, description, status) values ($1, 'turnos', $2, $3, $4)`,
    [fasutoId, ext, desc, status],
  )

describe("descripción obligatoria (no negociable del paquete)", () => {
  it("sin descripción no llega a READY", async () => {
    await expect(insertAsset(null, "READY")).rejects.toThrow(/cos_assets_description_required/)
  })
  it("con descripción corta tampoco (menos de 15 caracteres, espacios no cuentan)", async () => {
    await expect(insertAsset("   onigiri      ", "READY")).rejects.toThrow(/cos_assets_description_required/)
  })
  it("con descripción de verdad, sí", async () => {
    await insertAsset("Caja con los 3 onigiris recién armados", "READY")
  })
  it("sin descripción puede quedar esperando (MISSING_DESCRIPTION)", async () => {
    await insertAsset(null, "MISSING_DESCRIPTION")
  })
  it("no se puede sacar la descripción de algo que ya está listo", async () => {
    await insertAsset("Caja con los 3 onigiris recién armados", "READY")
    await expect(db.query(`update cos_assets set description = null`)).rejects.toThrow(
      /cos_assets_description_required/,
    )
  })
  it("el mismo envío de Turnos no entra dos veces", async () => {
    await insertAsset("Caja con los 3 onigiris recién armados", "READY", "sub-9")
    await expect(insertAsset("Caja con los 3 onigiris recién armados", "READY", "sub-9")).rejects.toThrow(
      /unique|duplicate/i,
    )
  })
})

describe("versiones inmutables", () => {
  it("una versión no se modifica ni se borra, y el número no se repite", async () => {
    await insertAsset("Caja con los 3 onigiris recién armados", "READY")
    const asset = await one<{ id: string }>(db, `select id from cos_assets`)
    await db.query(
      `insert into cos_asset_versions (asset_id, version_number, kind, drive_file_id) values ($1, 1, 'original', 'f1')`,
      [asset.id],
    )
    await expect(db.query(`update cos_asset_versions set drive_file_id = 'otro'`)).rejects.toThrow(/inmutables/)
    await expect(db.query(`delete from cos_asset_versions`)).rejects.toThrow(/inmutables/)
    await expect(
      db.query(
        `insert into cos_asset_versions (asset_id, version_number, kind, drive_file_id) values ($1, 1, 'ffmpeg', 'f2')`,
        [asset.id],
      ),
    ).rejects.toThrow(/unique|duplicate/i)
  })
})

describe("datos iniciales", () => {
  it("3 marcas activas y 6 cuentas, sin StohrBurgers", async () => {
    const marcas = await db.query<{ slug: string }>(`select slug from cos_brands order by slug`)
    expect(marcas.rows.map((m) => m.slug)).toEqual(["bijutsukan", "fasutofudo", "sensaciones"])
    const cuentas = await one<{ n: number }>(db, `select count(*)::int as n from cos_social_accounts`)
    expect(cuentas.n).toBe(6)
    const stohr = await db.query(`select 1 from cos_social_accounts where external_id = '912064518654294'`)
    expect(stohr.rows).toHaveLength(0)
  })

  it("las cuentas guardan el NOMBRE de la variable del token, nunca un token", async () => {
    const r = await db.query<{ token_ref: string }>(`select token_ref from cos_social_accounts`)
    for (const { token_ref } of r.rows) expect(token_ref).toMatch(/^META_PAGE_TOKEN_[A-Z]+$/)
  })

  it("correr los datos iniciales de nuevo no duplica nada", async () => {
    await db.exec(readFileSync(join(__dirname, "../../supabase/migrations/0002_cos_seed_marcas.sql"), "utf8"))
    const n = await one<{ b: number; a: number }>(
      db,
      `select (select count(*)::int from cos_brands) as b, (select count(*)::int from cos_social_accounts) as a`,
    )
    expect(n).toEqual({ b: 3, a: 6 })
  })
})

describe("configuración", () => {
  it("arranca con modo seguro, sin pausa y con las palabras clave apagadas", async () => {
    const s = await one(db, `select safe_mode, global_pause, triggers_pause from cos_settings`)
    expect(s).toEqual({ safe_mode: true, global_pause: false, triggers_pause: true })
  })
  it("el modo seguro no se puede apagar (queda fijo durante la prueba)", async () => {
    await expect(db.query(`update cos_settings set safe_mode = false`)).rejects.toThrow(/check/)
  })
  it("hay una sola fila de configuración", async () => {
    await expect(db.query(`insert into cos_settings (id) values (false)`)).rejects.toThrow(/check/)
  })
})

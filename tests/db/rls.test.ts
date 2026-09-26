/**
 * Quién ve y quién escribe (PLAN §4): hoy entra cualquier usuario de OlivosSpeed a
 * Social Hub; la base tiene que protegerse sola aunque el código falle.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { type Db, freshDb, crearUsuarios, crearPostFasutofudo, asRole, JAVIER, EXTRANO } from "./harness"

let db: Db
beforeEach(async () => {
  db = await freshDb()
  await crearUsuarios(db)
  await crearPostFasutofudo(db)
  await db.query(`insert into cos_members (user_id, role) values ($1, 'admin')`, [JAVIER])
})

describe("lectura", () => {
  it("sin sesión (anon) no se lee nada", async () => {
    await expect(asRole(db, "anon", () => db.query(`select * from cos_posts`))).rejects.toThrow(/permission denied/)
  })

  it("un usuario logueado que NO es miembro no ve nada", async () => {
    const r = await asRole(db, "authenticated", () => db.query(`select * from cos_posts`), EXTRANO)
    expect(r.rows).toHaveLength(0)
    const m = await asRole(db, "authenticated", () => db.query(`select * from cos_members`), EXTRANO)
    expect(m.rows).toHaveLength(0)
  })

  it("un miembro ve los posts y las marcas", async () => {
    const r = await asRole(db, "authenticated", () => db.query(`select * from cos_posts`), JAVIER)
    expect(r.rows).toHaveLength(1)
    const b = await asRole(db, "authenticated", () => db.query(`select * from cos_brands`), JAVIER)
    expect(b.rows).toHaveLength(3)
  })
})

describe("escritura", () => {
  it("ni siquiera un miembro escribe desde el navegador", async () => {
    await expect(
      asRole(db, "authenticated", () => db.query(`update cos_posts set caption = 'hackeado'`), JAVIER),
    ).rejects.toThrow(/permission denied/)
    await expect(
      asRole(db, "authenticated", () => db.query(`insert into cos_members (user_id, role) values ($1, 'admin')`, [EXTRANO]), EXTRANO),
    ).rejects.toThrow(/permission denied/)
  })

  it("el navegador no puede usar la cola ni el hash", async () => {
    await expect(
      asRole(db, "authenticated", () => db.query(`select * from cos_claim_jobs('w', null, 1)`), JAVIER),
    ).rejects.toThrow(/permission denied/)
    await expect(
      asRole(db, "authenticated", () => db.query(`select cos_enqueue_job('publish')`), JAVIER),
    ).rejects.toThrow(/permission denied/)
  })

  it("el servidor (service_role) sí escribe y usa la cola", async () => {
    await asRole(db, "service_role", async () => {
      await db.query(`update cos_posts set caption = 'desde el servidor'`)
      await db.query(`select cos_enqueue_job('publish')`)
    })
  })
})

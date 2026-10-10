/**
 * Sets de anuncios a pedido (0039): las reglas de la tabla y que el navegador solo lea.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { type Db, freshDb, crearUsuarios, asRole, one, JAVIER, EXTRANO } from "./harness"

let db: Db
let brand: string
beforeEach(async () => {
  db = await freshDb()
  await crearUsuarios(db)
  await db.query(`insert into cos_members (user_id, role) values ($1, 'admin')`, [JAVIER])
  brand = (await one<{ id: string }>(db, `select id from cos_brands where slug = 'fasutofudo'`)).id
})

const nuevoSet = (extra = "") =>
  one<{ id: string }>(db, `insert into cos_ad_sets (brand_id, textos ${extra ? ", " + extra.split("=")[0] : ""}) values ($1, 'Puro salmón 40 piezas' ${extra ? ", " + extra.split("=")[1] : ""}) returning id`, [brand])

describe("cos_ad_sets", () => {
  it("guarda el pedido con sus valores por defecto y una versión por número", async () => {
    const s = await nuevoSet()
    const r = await one<{ versiones: number; formato: string; fuentes: string[]; estado: string }>(db, `select versiones, formato, fuentes, estado from cos_ad_sets where id = $1`, [s.id])
    expect(r).toEqual({ versiones: 3, formato: "ambos", fuentes: ["instagram", "archivo"], estado: "preparando" })
    await db.query(`insert into cos_ad_set_versiones (set_id, numero, texto) values ($1, 1, 'Puro salmón')`, [s.id])
    await expect(db.query(`insert into cos_ad_set_versiones (set_id, numero, texto) values ($1, 1, 'otra')`, [s.id])).rejects.toThrow(/duplicate/)
  })

  it("rechaza fuentes desconocidas y más de 6 versiones", async () => {
    await expect(nuevoSet(`fuentes='{drive}'`)).rejects.toThrow(/check/)
    await expect(nuevoSet(`versiones=7`)).rejects.toThrow(/check/)
  })

  it("al borrar el pedido se van sus versiones", async () => {
    const s = await nuevoSet()
    await db.query(`insert into cos_ad_set_versiones (set_id, numero, texto) values ($1, 1, 'x')`, [s.id])
    await db.query(`delete from cos_ad_sets where id = $1`, [s.id])
    expect((await db.query(`select 1 from cos_ad_set_versiones`)).rows).toHaveLength(0)
  })

  it("un miembro lee; nadie escribe desde el navegador; un extraño no ve nada", async () => {
    await nuevoSet()
    const r = await asRole(db, "authenticated", () => db.query(`select * from cos_ad_sets`), JAVIER)
    expect(r.rows).toHaveLength(1)
    const x = await asRole(db, "authenticated", () => db.query(`select * from cos_ad_sets`), EXTRANO)
    expect(x.rows).toHaveLength(0)
    await expect(asRole(db, "authenticated", () => db.query(`update cos_ad_sets set textos = 'hackeado'`), JAVIER)).rejects.toThrow(/permission denied/)
  })
})

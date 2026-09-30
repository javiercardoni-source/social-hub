/**
 * F9 — migración 0019: el guion del reel no se puede cambiar después de aprobado, y no toca el
 * hash de aprobación (lo que se ve —gancho y música— ya está en el hash).
 */
import { describe, it, expect, beforeEach } from "vitest"
import { type Db, freshDb, crearUsuarios, crearPostFasutofudo, estado, one, JAVIER } from "./harness"

let db: Db
beforeEach(async () => {
  db = await freshDb()
  await crearUsuarios(db)
})

const GUION = JSON.stringify({ tomas: [{ fuente: 0, trim_start: 0, duracion: 2.4 }], gancho: "NOCHE DE SUSHI" })

async function aprobar(postId: string) {
  await db.query(`update cos_posts set status = 'PENDING_APPROVAL' where id = $1`, [postId])
  await db.query(`update cos_posts set status = 'APPROVED', approved_by = $2 where id = $1`, [postId, JAVIER])
}

describe("guion del reel", () => {
  it("se puede escribir y cambiar mientras espera aprobación, sin tocar el hash", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await db.query(`update cos_posts set status = 'PENDING_APPROVAL' where id = $1`, [postId])
    const h0 = (await one<{ h: string }>(db, `select cos_post_content_hash($1) as h`, [postId])).h
    await db.query(`update cos_posts set montaje = $2 where id = $1`, [postId, GUION])
    await db.query(`update cos_posts set montaje = jsonb_set(montaje, '{gancho}', '"OTRO"') where id = $1`, [postId])
    expect((await one<{ h: string }>(db, `select cos_post_content_hash($1) as h`, [postId])).h).toBe(h0)
  })

  it("con el post aprobado o programado, el guion no se cambia", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await db.query(`update cos_posts set montaje = $2 where id = $1`, [postId, GUION])
    await aprobar(postId)
    await expect(db.query(`update cos_posts set montaje = '{"tomas": []}' where id = $1`, [postId])).rejects.toThrow(/guion del reel/)
    await db.query(`update cos_posts set status = 'SCHEDULED' where id = $1`, [postId])
    await expect(db.query(`update cos_posts set montaje = null where id = $1`, [postId])).rejects.toThrow(/guion del reel/)
    expect((await estado(db, postId)).status).toBe("SCHEDULED")
  })

  it("devuelto a aprobación (por un cambio de gancho), el guion se puede rehacer", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await db.query(`update cos_posts set montaje = $2 where id = $1`, [postId, GUION])
    await aprobar(postId)
    await db.query(`update cos_posts set overlay_text = 'OTRO GANCHO' where id = $1`, [postId])
    expect((await estado(db, postId)).status).toBe("PENDING_APPROVAL")
    await db.query(`update cos_posts set montaje = '{"tomas": [], "gancho": "OTRO GANCHO"}' where id = $1`, [postId])
  })

  it("post de foto fija apagado por defecto (se basa todo en video)", async () => {
    expect((await one<{ foto_fija: boolean }>(db, `select foto_fija from cos_settings`)).foto_fija).toBe(false)
  })
})

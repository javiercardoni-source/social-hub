/**
 * F8 — migración 0020: se aprueba contenido + ventana. El motor mueve la hora dentro de la
 * ventana, nunca a menos de 3 h; lo fijado a mano no se mueve; cambiar la ventana vuelve a
 * aprobación. Si alguno se rompe, se podría publicar en un momento que Javier no aprobó.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { type Db, freshDb, crearUsuarios, crearPostFasutofudo, estado, one, JAVIER } from "./harness"

let db: Db
beforeEach(async () => {
  db = await freshDb()
  await crearUsuarios(db)
})

const H = 3600_000
const iso = (msDesdeAhora: number) => new Date(Date.now() + msDesdeAhora).toISOString()

/** Post aprobado y programado con ventana [+10 h, +58 h] a las +20 h. */
async function programadoConVentana(lock = false) {
  const { postId } = await crearPostFasutofudo(db)
  await db.query(
    `update cos_posts set status = 'PENDING_APPROVAL', scheduled_at = $2, window_start = $3, window_end = $4,
       schedule_lock = $5, schedule_source = 'motor' where id = $1`,
    [postId, iso(20 * H), iso(10 * H), iso(58 * H), lock],
  )
  await db.query(`update cos_posts set status = 'APPROVED', approved_by = $2 where id = $1`, [postId, JAVIER])
  await db.query(`update cos_posts set status = 'SCHEDULED' where id = $1`, [postId])
  return postId
}

describe("ventana aprobada", () => {
  it("el motor mueve la hora dentro de la ventana sin volver a aprobación ni cambiar el sello", async () => {
    const id = await programadoConVentana()
    const antes = await estado(db, id)
    await db.query(`update cos_posts set scheduled_at = $2 where id = $1`, [id, iso(30 * H)])
    const despues = await estado(db, id)
    expect(despues.status).toBe("SCHEDULED")
    expect(despues.approved_hash).toBe(antes.approved_hash)
  })

  it("fuera de la ventana: la base no lo deja", async () => {
    const id = await programadoConVentana()
    await expect(db.query(`update cos_posts set scheduled_at = $2 where id = $1`, [id, iso(70 * H)])).rejects.toThrow(/fuera de la ventana/)
    await expect(db.query(`update cos_posts set scheduled_at = $2 where id = $1`, [id, iso(5 * H)])).rejects.toThrow(/fuera de la ventana/)
  })

  it("nunca a menos de 3 h: ni moverlo hacia ahí, ni mover algo que sale en menos de 3 h", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await db.query(
      `update cos_posts set status = 'PENDING_APPROVAL', scheduled_at = $2, window_start = $3, window_end = $4 where id = $1`,
      [postId, iso(2 * H), iso(1 * H), iso(30 * H)],
    )
    await db.query(`update cos_posts set status = 'APPROVED', approved_by = $2 where id = $1`, [postId, JAVIER])
    await db.query(`update cos_posts set status = 'SCHEDULED' where id = $1`, [postId])
    // Sale en 2 h: no se toca.
    await expect(db.query(`update cos_posts set scheduled_at = $2 where id = $1`, [postId, iso(20 * H)])).rejects.toThrow(/3 h/)
    // Y algo que sale más tarde no se puede traer a menos de 3 h.
    const otro = await programadoConVentana()
    await db.query(`update cos_posts set window_start = window_start where id = $1`, [otro])
    await expect(db.query(`update cos_posts set scheduled_at = $2 where id = $1`, [otro, iso(2 * H)])).rejects.toThrow()
  })

  it("cambiar la ventana vuelve a aprobación", async () => {
    const id = await programadoConVentana()
    await db.query(`update cos_posts set window_end = window_end + interval '1 day' where id = $1`, [id])
    expect((await estado(db, id)).status).toBe("PENDING_APPROVAL")
  })

  it("fijado a mano (🔒): cambiar la hora vuelve a aprobación, como siempre", async () => {
    const id = await programadoConVentana(true)
    await db.query(`update cos_posts set scheduled_at = $2 where id = $1`, [id, iso(30 * H)])
    expect((await estado(db, id)).status).toBe("PENDING_APPROVAL")
  })

  it("sin ventana: la hora exacta es parte de lo aprobado (como antes)", async () => {
    const { postId } = await crearPostFasutofudo(db) // viene con scheduled_at fijo
    await db.query(`update cos_posts set status = 'PENDING_APPROVAL' where id = $1`, [postId])
    await db.query(`update cos_posts set status = 'APPROVED', approved_by = $2 where id = $1`, [postId, JAVIER])
    await db.query(`update cos_posts set status = 'SCHEDULED' where id = $1`, [postId])
    await db.query(`update cos_posts set scheduled_at = scheduled_at + interval '1 hour' where id = $1`, [postId])
    expect((await estado(db, postId)).status).toBe("PENDING_APPROVAL")
  })

  it("no se programa con la hora fuera de su ventana", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await db.query(
      `update cos_posts set status = 'PENDING_APPROVAL', scheduled_at = $2, window_start = $3, window_end = $4 where id = $1`,
      [postId, iso(80 * H), iso(10 * H), iso(58 * H)],
    )
    await db.query(`update cos_posts set status = 'APPROVED', approved_by = $2 where id = $1`, [postId, JAVIER])
    await expect(db.query(`update cos_posts set status = 'SCHEDULED' where id = $1`, [postId])).rejects.toThrow(/fuera de la ventana/)
  })

  it("la ventana tiene que ser válida (las dos puntas y en orden)", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await expect(db.query(`update cos_posts set window_start = now() where id = $1`, [postId])).rejects.toThrow(/cos_posts_window_ok/)
    await expect(db.query(`update cos_posts set window_start = now(), window_end = now() - interval '1 hour' where id = $1`, [postId])).rejects.toThrow(/cos_posts_window_ok/)
  })

  it("publicado: la hora tampoco se toca", async () => {
    const id = await programadoConVentana()
    await db.query(`update cos_posts set status = 'PUBLISHING' where id = $1`, [id])
    await db.query(`update cos_posts set status = 'PUBLISHED', published_at = now() where id = $1`, [id])
    await expect(db.query(`update cos_posts set scheduled_at = $2 where id = $1`, [id, iso(30 * H)])).rejects.toThrow(/no se puede editar/)
  })

  it("el registro de movimientos y el porqué no tocan la aprobación", async () => {
    const id = await programadoConVentana()
    const antes = await estado(db, id)
    await db.query(
      `update cos_posts set schedule_log = schedule_log || '[{"de": "a", "a": "b"}]'::jsonb, schedule_reason = 'otra', predicted_lift = 1.3 where id = $1`,
      [id],
    )
    expect(await estado(db, id)).toEqual(antes)
  })

  it("marca: agenda apagada y historias de clima prendidas por defecto", async () => {
    const b = await one<{ agenda_auto: boolean; clima_historias: boolean }>(db, `select agenda_auto, clima_historias from cos_brands where slug = 'fasutofudo'`)
    expect(b).toEqual({ agenda_auto: false, clima_historias: true })
  })
})


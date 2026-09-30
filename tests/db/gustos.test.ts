/**
 * F7 M0 — migración 0018: el tema de cada post, sin tocar la aprobación.
 * Si alguno de estos tests se rompe, registrar la música podría devolver a aprobación (o
 * dejar pasar) algo que Javier ya aprobó.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { type Db, freshDb, crearUsuarios, crearPostFasutofudo, estado, one, asRole, JAVIER, EXTRANO } from "./harness"

let db: Db
beforeEach(async () => {
  db = await freshDb()
  await crearUsuarios(db)
})

async function tema(brandId: string, key: string) {
  return one<{ id: string }>(db, `insert into cos_music_tracks (brand_id, storage_key, title) values ($1, $2, 't') returning id`, [brandId, key])
}

async function programar(postId: string) {
  await db.query(`update cos_posts set status = 'PENDING_APPROVAL' where id = $1`, [postId])
  await db.query(`update cos_posts set status = 'APPROVED', approved_by = $2 where id = $1`, [postId, JAVIER])
  await db.query(`update cos_posts set status = 'SCHEDULED' where id = $1`, [postId])
}

const KEY = "music/fasutofudo/house-1.mp3"

describe("post ↔ tema", () => {
  it("al guardar music_key, la base completa music_track_id sola", async () => {
    const { postId, brandId } = await crearPostFasutofudo(db)
    const t = await tema(brandId, KEY)
    await db.query(`update cos_posts set music_key = $2 where id = $1`, [postId, KEY])
    expect((await one<{ music_track_id: string }>(db, `select music_track_id from cos_posts where id = $1`, [postId])).music_track_id).toBe(t.id)
    await db.query(`update cos_posts set music_key = null where id = $1`, [postId])
    expect((await one(db, `select music_track_id from cos_posts where id = $1`, [postId])).music_track_id).toBeNull()
  })

  it("un tema registrado tarde se vincula a los posts que ya lo usaban", async () => {
    const { postId, brandId } = await crearPostFasutofudo(db)
    await db.query(`update cos_posts set music_key = $2 where id = $1`, [postId, KEY])
    const t = await tema(brandId, KEY)
    expect((await one(db, `select music_track_id from cos_posts where id = $1`, [postId])).music_track_id).toBe(t.id)
  })

  it("vincular el tema NO cambia el hash ni devuelve a aprobación un post programado", async () => {
    const { postId, brandId } = await crearPostFasutofudo(db)
    await db.query(`update cos_posts set music_key = $2 where id = $1`, [postId, KEY])
    await programar(postId)
    const antes = await estado(db, postId)
    const hashAntes = (await one<{ h: string }>(db, `select cos_post_content_hash($1) as h`, [postId])).h
    expect(antes.status).toBe("SCHEDULED")

    // El tema aparece después (sincronización) y además se toca a mano el vínculo y el porqué.
    const t = await tema(brandId, KEY)
    await db.query(`update cos_posts set pick_json = '{"motor": "azar"}' where id = $1`, [postId])
    await db.query(`update cos_posts set music_track_id = null where id = $1`, [postId])
    await db.query(`update cos_posts set music_track_id = $2 where id = $1`, [postId, t.id])

    const despues = await estado(db, postId)
    expect(despues.status).toBe("SCHEDULED")
    expect(despues.approved_hash).toBe(antes.approved_hash)
    expect((await one<{ h: string }>(db, `select cos_post_content_hash($1) as h`, [postId])).h).toBe(hashAntes)
  })

  it("cambiar la música sí sigue devolviendo a aprobación (el tema no lo esquiva)", async () => {
    const { postId, brandId } = await crearPostFasutofudo(db)
    await tema(brandId, KEY)
    await tema(brandId, "music/fasutofudo/otro.mp3")
    await db.query(`update cos_posts set music_key = $2 where id = $1`, [postId, KEY])
    await programar(postId)
    await db.query(`update cos_posts set music_key = 'music/fasutofudo/otro.mp3' where id = $1`, [postId])
    expect((await estado(db, postId)).status).toBe("PENDING_APPROVAL")
  })

  it("un post publicado se puede vincular a su tema (no es editar contenido)", async () => {
    const { postId, brandId } = await crearPostFasutofudo(db)
    await db.query(`update cos_posts set music_key = $2 where id = $1`, [postId, KEY])
    await programar(postId)
    await db.query(`update cos_posts set status = 'PUBLISHING' where id = $1`, [postId])
    await db.query(`update cos_posts set status = 'PUBLISHED', published_at = now() where id = $1`, [postId])
    const t = await tema(brandId, KEY)
    const p = await one<{ status: string; music_track_id: string }>(db, `select status, music_track_id from cos_posts where id = $1`, [postId])
    expect(p).toEqual({ status: "PUBLISHED", music_track_id: t.id })
  })

  it("sacar un tema de la biblioteca no lo borra: los posts conservan el vínculo", async () => {
    const { postId, brandId } = await crearPostFasutofudo(db)
    const t = await tema(brandId, KEY)
    await db.query(`update cos_posts set music_key = $2 where id = $1`, [postId, KEY])
    await db.query(`update cos_music_tracks set active = false where id = $1`, [t.id])
    expect((await one(db, `select music_track_id from cos_posts where id = $1`, [postId])).music_track_id).toBe(t.id)
  })
})

describe("fichas de temas", () => {
  it("un tema no puede quedar en la biblioteca de otra marca", async () => {
    const { brandId } = await crearPostFasutofudo(db)
    await expect(tema(brandId, "music/sensaciones/tema.mp3")).rejects.toThrow(/carpeta de su marca/)
    const t = await tema(brandId, KEY)
    const otra = await one<{ id: string }>(db, `select id from cos_brands where slug = 'bijutsukan'`)
    await expect(db.query(`update cos_music_tracks set brand_id = $2 where id = $1`, [t.id, otra.id])).rejects.toThrow(/carpeta de su marca/)
  })

  it("vocabulario cerrado también en la base", async () => {
    const { brandId } = await crearPostFasutofudo(db)
    const t = await tema(brandId, KEY)
    await db.query(`update cos_music_tracks set genre = 'jazz', mood = '{relajado,elegante}', vocals = false, energy = 0.4 where id = $1`, [t.id])
    await expect(db.query(`update cos_music_tracks set genre = 'cumbia' where id = $1`, [t.id])).rejects.toThrow(/check/)
    await expect(db.query(`update cos_music_tracks set mood = '{triste}' where id = $1`, [t.id])).rejects.toThrow(/check/)
    await expect(db.query(`update cos_music_tracks set energy = 1.5 where id = $1`, [t.id])).rejects.toThrow(/check/)
  })

  it("una sugerencia por marca, semana y tipo (el job semanal no duplica)", async () => {
    const { brandId } = await crearPostFasutofudo(db)
    await db.query(`insert into cos_suggestions (brand_id, week, kind) values ($1, '2026-10-05', 'musica')`, [brandId])
    await expect(db.query(`insert into cos_suggestions (brand_id, week, kind) values ($1, '2026-10-05', 'musica')`, [brandId])).rejects.toThrow(/unique|duplicate/)
  })
})

describe("permisos", () => {
  beforeEach(async () => {
    await db.query(`insert into cos_members (user_id, role) values ($1, 'admin')`, [JAVIER])
    const { brandId } = await crearPostFasutofudo(db)
    await tema(brandId, KEY)
  })

  it("un miembro lee; un logueado que no es miembro no ve nada; anon no entra", async () => {
    for (const tabla of ["cos_music_tracks", "cos_taste_models", "cos_suggestions"]) {
      await asRole(db, "authenticated", () => db.query(`select * from ${tabla}`), JAVIER)
      expect((await asRole(db, "authenticated", () => db.query(`select * from ${tabla}`), EXTRANO)).rows).toHaveLength(0)
      await expect(asRole(db, "anon", () => db.query(`select * from ${tabla}`))).rejects.toThrow(/permission denied/)
    }
    expect((await asRole(db, "authenticated", () => db.query(`select * from cos_music_tracks`), JAVIER)).rows).toHaveLength(1)
  })

  it("nadie escribe desde el navegador, ni siendo miembro", async () => {
    await expect(asRole(db, "authenticated", () => db.query(`update cos_music_tracks set genre = 'jazz'`), JAVIER)).rejects.toThrow(/permission denied/)
    await expect(
      asRole(db, "authenticated", () => db.query(`insert into cos_suggestions (brand_id, week, kind) select id, '2026-10-05', 'musica' from cos_brands limit 1`), JAVIER),
    ).rejects.toThrow(/permission denied/)
  })
})

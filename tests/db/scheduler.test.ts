/**
 * El reloj (cos_scheduler_tick, migración 0003): vencer, perder, publicar y reconciliar.
 * PLAN §5 (MISSED_POST_POLICY) y §6 (sin duplicados).
 */
import { describe, it, expect, beforeEach } from "vitest"
import { type Db, freshDb, crearUsuarios, crearPostFasutofudo, estado, one, JAVIER } from "./harness"

let db: Db
beforeEach(async () => {
  db = await freshDb()
  await crearUsuarios(db)
})

type Tick = { paused: boolean; expired: number; missed?: number; publish?: number; reconcile?: number }
const tick = async () => (await one<{ r: Tick }>(db, `select cos_scheduler_tick() as r`)).r
const jobs = async (type: string) =>
  (await db.query<{ dedupe_key: string; max_attempts: number }>(`select dedupe_key, max_attempts from cos_jobs where type = $1`, [type])).rows

/** Post aprobado y programado a `minutos` de ahora (negativo = en el pasado). */
async function programado(minutos: number) {
  const { postId } = await crearPostFasutofudo(db)
  await db.query(`update cos_posts set scheduled_at = now() + ($2::text || ' minutes')::interval where id = $1`, [postId, minutos])
  await db.query(`update cos_posts set status = 'PENDING_APPROVAL' where id = $1`, [postId])
  await db.query(`update cos_posts set status = 'APPROVED', approved_by = $2 where id = $1`, [postId, JAVIER])
  await db.query(`update cos_posts set status = 'SCHEDULED' where id = $1`, [postId])
  return postId
}

describe("vencer lo que no se aprobó", () => {
  it("un post esperando aprobación cuya hora pasó se vence y NO se publica", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await db.query(`update cos_posts set scheduled_at = now() - interval '5 minutes', status = 'PENDING_APPROVAL' where id = $1`, [postId])
    expect((await tick()).expired).toBe(1)
    expect((await estado(db, postId)).status).toBe("EXPIRED")
    expect(await jobs("post:publish")).toHaveLength(0)
  })
})

describe("publicar a horario", () => {
  it("todavía no es la hora: no hace nada", async () => {
    const id = await programado(10)
    await tick()
    expect((await estado(db, id)).status).toBe("SCHEDULED")
    expect(await jobs("post:publish")).toHaveLength(0)
  })

  it("llegó la hora: encola UNA publicación, aunque el reloj pase varias veces", async () => {
    const id = await programado(-0.1)
    await tick()
    await tick()
    await tick()
    const j = await jobs("post:publish")
    expect(j).toEqual([{ dedupe_key: `publish:${id}`, max_attempts: 1 }])
  })

  it("un reintento vencido también se encola", async () => {
    const id = await programado(-0.1)
    for (const s of ["PUBLISHING", "FAILED", "RETRY_SCHEDULED"]) {
      await db.query(`update cos_posts set status = $2 where id = $1`, [id, s])
    }
    await db.query(`update cos_posts set next_attempt_at = now() - interval '1 second' where id = $1`, [id])
    expect((await tick()).publish).toBe(1)
  })
})

describe("MISSED_POST_POLICY", () => {
  it("hasta 30 minutos tarde, se publica igual", async () => {
    await programado(-29)
    expect((await tick()).publish).toBe(1)
  })

  it("más de 30 minutos tarde, queda perdido con el motivo", async () => {
    const id = await programado(-31)
    const t = await tick()
    expect(t).toMatchObject({ missed: 1, publish: 0 })
    const p = await one<{ status: string; last_error: string }>(db, `select status, last_error from cos_posts where id = $1`, [id])
    expect(p.status).toBe("MISSED")
    expect(p.last_error).toMatch(/31 min tarde/)
  })

  it("con la política estricta, 5 minutos tarde ya queda perdido", async () => {
    await db.query(`update cos_settings set missed_post_policy = 'never_publish_late'`)
    await programado(-5)
    expect((await tick()).missed).toBe(1)
  })
})

describe("pausa general", () => {
  it("congela todo, pero igual vence lo que no se aprobó", async () => {
    const id = await programado(-1)
    const { postId: sinAprobar } = await crearPostFasutofudo(db)
    await db.query(`update cos_posts set scheduled_at = now() - interval '1 minute', status = 'PENDING_APPROVAL' where id = $1`, [sinAprobar])
    await db.query(`update cos_settings set global_pause = true`)
    expect(await tick()).toEqual({ paused: true, expired: 1 })
    expect((await estado(db, id)).status).toBe("SCHEDULED")
    expect(await jobs("post:publish")).toHaveLength(0)
  })
})

describe("worker caído a mitad de una publicación", () => {
  it("un post trabado en 'publicando' sin trabajo vivo se manda a reconciliar", async () => {
    const id = await programado(-1)
    await db.query(`update cos_posts set status = 'PUBLISHING' where id = $1`, [id])
    await db.query(`alter table cos_posts disable trigger cos_posts_guard`)
    await db.query(`update cos_posts set updated_at = now() - interval '15 minutes' where id = $1`, [id])
    await db.query(`alter table cos_posts enable trigger cos_posts_guard`)
    expect((await tick()).reconcile).toBe(1)
    expect((await tick()).reconcile).toBe(1) // la dedupe evita el segundo trabajo
    expect(await jobs("post:reconcile")).toHaveLength(1)
  })
})

describe("almacenamiento", () => {
  it("arranca en simulación, con el bucket privado de medios", async () => {
    const s = await one(db, `select publish_mode, storage_driver from cos_settings`)
    expect(s).toEqual({ publish_mode: "simulated", storage_driver: "supabase" })
    const b = await one(db, `select public from storage.buckets where id = 'cos-media'`)
    expect(b.public).toBe(false)
  })

  it("una versión tiene que saber dónde vive", async () => {
    const { assetId } = await crearPostFasutofudo(db)
    await expect(
      db.query(`insert into cos_asset_versions (asset_id, version_number, kind) values ($1, 9, 'original')`, [assetId]),
    ).rejects.toThrow(/cos_versions_location/)
    await db.query(
      `insert into cos_asset_versions (asset_id, version_number, kind, storage_key) values ($1, 9, 'original', 'fasutofudo/x.jpg')`,
      [assetId],
    )
  })
})

describe("consentimiento", () => {
  it("un post con una foto bloqueada (caras de clientes) no se puede programar", async () => {
    const { postId, assetId } = await crearPostFasutofudo(db)
    await db.query(`update cos_assets set consent = 'blocked' where id = $1`, [assetId])
    await db.query(`update cos_posts set status = 'PENDING_APPROVAL' where id = $1`, [postId])
    await db.query(`update cos_posts set status = 'APPROVED', approved_by = $2 where id = $1`, [postId, JAVIER])
    await expect(db.query(`update cos_posts set status = 'SCHEDULED' where id = $1`, [postId])).rejects.toThrow(
      /bloqueado por consentimiento/,
    )
    await db.query(`update cos_assets set consent = 'ok' where id = $1`, [assetId])
    await db.query(`update cos_posts set status = 'SCHEDULED' where id = $1`, [postId])
  })
})

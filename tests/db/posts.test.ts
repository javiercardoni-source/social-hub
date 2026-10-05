/**
 * Las reglas de aprobación que hace cumplir la base (PLAN §4 `approved_hash`, §5).
 * Si alguno de estos tests se rompe, hay riesgo de publicar algo que Javier no aprobó.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { type Db, freshDb, crearUsuarios, crearPostFasutofudo, estado, one, JAVIER } from "./harness"

let db: Db
beforeEach(async () => {
  db = await freshDb()
  await crearUsuarios(db)
})

async function aprobar(postId: string) {
  await db.query(`update cos_posts set status = 'PENDING_APPROVAL' where id = $1 and status = 'DRAFT'`, [postId])
  await db.query(`update cos_posts set status = 'APPROVED', approved_by = $2 where id = $1`, [postId, JAVIER])
}

describe("nacimiento de un post", () => {
  it("no puede nacer aprobado ni programado", async () => {
    const { brandId, accountId } = await crearPostFasutofudo(db)
    await expect(
      db.query(
        `insert into cos_posts (brand_id, account_id, platform, post_type, status)
         values ($1, $2, 'instagram', 'feed', 'SCHEDULED')`,
        [brandId, accountId],
      ),
    ).rejects.toThrow(/nace como DRAFT/)
  })

  it("ignora un approved_hash que venga del cliente al crear", async () => {
    const { brandId, accountId } = await crearPostFasutofudo(db)
    const p = await one<{ approved_hash: string | null }>(
      db,
      `insert into cos_posts (brand_id, account_id, platform, post_type, approved_hash)
       values ($1, $2, 'instagram', 'feed', 'trucho') returning approved_hash`,
      [brandId, accountId],
    )
    expect(p.approved_hash).toBeNull()
  })

  it("la cuenta tiene que ser de la misma marca y red", async () => {
    const { accountId } = await crearPostFasutofudo(db)
    const otraMarca = await one<{ id: string }>(db, `select id from cos_brands where slug = 'sensaciones'`)
    await expect(
      db.query(
        `insert into cos_posts (brand_id, account_id, platform, post_type) values ($1, $2, 'instagram', 'feed')`,
        [otraMarca.id, accountId],
      ),
    ).rejects.toThrow(/cos_posts_account_fk/)
    const fasuto = await one<{ id: string }>(db, `select id from cos_brands where slug = 'fasutofudo'`)
    await expect(
      db.query(
        `insert into cos_posts (brand_id, account_id, platform, post_type) values ($1, $2, 'facebook', 'feed')`,
        [fasuto.id, accountId],
      ),
    ).rejects.toThrow(/cos_posts_account_fk/)
  })
})

describe("aprobación sellada por la base", () => {
  it("aprobar exige quién aprueba", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await db.query(`update cos_posts set status = 'PENDING_APPROVAL' where id = $1`, [postId])
    await expect(db.query(`update cos_posts set status = 'APPROVED' where id = $1`, [postId])).rejects.toThrow(
      /falta quién aprueba/,
    )
  })

  it("al aprobar, la base calcula el hash del contenido (el cliente no puede imponerlo)", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await db.query(`update cos_posts set status = 'PENDING_APPROVAL' where id = $1`, [postId])
    await db.query(`update cos_posts set status = 'APPROVED', approved_by = $2, approved_hash = 'trucho' where id = $1`, [
      postId,
      JAVIER,
    ])
    const p = await estado(db, postId)
    const real = await one<{ h: string }>(db, `select cos_post_content_hash($1) as h`, [postId])
    expect(p.status).toBe("APPROVED")
    expect(p.approved_hash).toBe(real.h)
    expect(p.approved_hash).not.toBe("trucho")
  })

  it("nadie puede reescribir el hash de un post aprobado", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await aprobar(postId)
    await expect(db.query(`update cos_posts set approved_hash = 'trucho' where id = $1`, [postId])).rejects.toThrow(
      /solo lo escribe la base/,
    )
  })
})

describe("editar algo aprobado lo devuelve a aprobación", () => {
  it("cambiar el texto de un post aprobado", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await aprobar(postId)
    await db.query(`update cos_posts set caption = 'Otro texto' where id = $1`, [postId])
    const p = await estado(db, postId)
    expect(p.status).toBe("PENDING_APPROVAL")
    expect(p.approved_hash).toBeNull()
    expect(p.approved_by).toBeNull()
  })

  it("cambiar el texto sobre la imagen, la plantilla o la música de un post aprobado", async () => {
    for (const cambio of [
      "overlay_text = 'Tres onigiris'",
      "template = 'banda'",
      "music_key = 'music/fasutofudo/lofi.mp3'",
      "overlay_position = 'top'",
      "overlay_layout = 'top'",
    ]) {
      const { postId } = await crearPostFasutofudo(db)
      await aprobar(postId)
      await db.query(`update cos_posts set ${cambio} where id = $1`, [postId])
      expect((await estado(db, postId)).status).toBe("PENDING_APPROVAL")
    }
  })

  it("rehacer la imagen final (render_key) NO desaprueba: es derivada del contenido", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await aprobar(postId)
    await db.query(`update cos_posts set render_key = 'renders/x.jpg', render_qa = '{"ok":true}' where id = $1`, [postId])
    expect((await estado(db, postId)).status).toBe("APPROVED")
  })

  it("solo se puede pedir borrar un post publicado, y pedirlo no lo desaprueba", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await expect(db.query(`update cos_posts set delete_requested_at = now() where id = $1`, [postId])).rejects.toThrow()
    await aprobar(postId)
    await db.query(`update cos_posts set status = 'SCHEDULED' where id = $1`, [postId])
    await db.query(`update cos_posts set status = 'PUBLISHING' where id = $1`, [postId])
    await db.query(`update cos_posts set status = 'PUBLISHED' where id = $1`, [postId])
    await db.query(`update cos_posts set delete_requested_at = now(), deleted_at = now() where id = $1`, [postId])
    expect((await estado(db, postId)).status).toBe("PUBLISHED")
  })

  it("cambiar la fecha de un post programado", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await aprobar(postId)
    await db.query(`update cos_posts set status = 'SCHEDULED' where id = $1`, [postId])
    await db.query(`update cos_posts set scheduled_at = '2026-10-01T22:30:00Z' where id = $1`, [postId])
    expect((await estado(db, postId)).status).toBe("PENDING_APPROVAL")
  })

  it("cambiar o agregar una foto a un post aprobado", async () => {
    const { postId, assetId } = await crearPostFasutofudo(db)
    await aprobar(postId)
    const v2 = await one<{ id: string }>(
      db,
      `insert into cos_asset_versions (asset_id, version_number, kind, drive_file_id, parent_version_id)
       select $1, 2, 'ffmpeg', 'drive-file-2', id from cos_asset_versions where asset_id = $1 and version_number = 1
       returning id`,
      [assetId],
    )
    await db.query(`insert into cos_post_media (post_id, version_id, position) values ($1, $2, 1)`, [postId, v2.id])
    expect((await estado(db, postId)).status).toBe("PENDING_APPROVAL")
  })

  it("editar un borrador no cambia su estado", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await db.query(`update cos_posts set caption = 'Otro' where id = $1`, [postId])
    expect((await estado(db, postId)).status).toBe("DRAFT")
  })
})

describe("programar y publicar", () => {
  it("un post aprobado se puede programar y pasar a publicando", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await aprobar(postId)
    await db.query(`update cos_posts set status = 'SCHEDULED' where id = $1`, [postId])
    await db.query(`update cos_posts set status = 'PUBLISHING' where id = $1`, [postId])
    expect((await estado(db, postId)).status).toBe("PUBLISHING")
  })

  it("no se puede programar sin fecha", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await db.query(`update cos_posts set scheduled_at = null where id = $1`, [postId])
    await aprobar(postId)
    await expect(db.query(`update cos_posts set status = 'SCHEDULED' where id = $1`, [postId])).rejects.toThrow(
      /sin fecha/,
    )
  })

  it("no se puede saltar de borrador a publicado", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await expect(db.query(`update cos_posts set status = 'PUBLISHED' where id = $1`, [postId])).rejects.toThrow(
      /transición no permitida DRAFT → PUBLISHED/,
    )
  })

  it("no se puede pasar a publicando sin aprobación", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await db.query(`update cos_posts set status = 'PENDING_APPROVAL' where id = $1`, [postId])
    await expect(db.query(`update cos_posts set status = 'PUBLISHING' where id = $1`, [postId])).rejects.toThrow(
      /transición no permitida/,
    )
  })

  it("un post publicándose no se edita ni cambia de fotos", async () => {
    const { postId, versionId } = await crearPostFasutofudo(db)
    await aprobar(postId)
    await db.query(`update cos_posts set status = 'SCHEDULED' where id = $1`, [postId])
    await db.query(`update cos_posts set status = 'PUBLISHING' where id = $1`, [postId])
    await expect(db.query(`update cos_posts set caption = 'x' where id = $1`, [postId])).rejects.toThrow(
      /no se puede editar/,
    )
    await expect(
      db.query(`insert into cos_post_media (post_id, version_id, position) values ($1, $2, 5)`, [postId, versionId]),
    ).rejects.toThrow(/no se cambian los archivos/)
  })

  it("un post publicado no se borra; un borrador sí", async () => {
    const a = await crearPostFasutofudo(db)
    await aprobar(a.postId)
    for (const s of ["SCHEDULED", "PUBLISHING", "PUBLISHED"]) {
      await db.query(`update cos_posts set status = $2 where id = $1`, [a.postId, s])
    }
    await expect(db.query(`delete from cos_posts where id = $1`, [a.postId])).rejects.toThrow(/no se puede borrar/)

    const b = await crearPostFasutofudo(db, "borrador")
    await db.query(`delete from cos_posts where id = $1`, [b.postId])
    const r = await db.query(`select 1 from cos_posts where id = $1`, [b.postId])
    expect(r.rows).toHaveLength(0)
  })
})

describe("auditoría", () => {
  it("cada cambio de estado queda registrado y no se puede borrar", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await aprobar(postId)
    const r = await db.query<{ to: string }>(
      `select details_json->>'to' as to from cos_audit_log where entity_id = $1 order by id`,
      [postId],
    )
    expect(r.rows.map((x) => x.to)).toEqual(["DRAFT", "PENDING_APPROVAL", "APPROVED"])
    await expect(db.query(`delete from cos_audit_log`)).rejects.toThrow(/solo de agregado/)
    await expect(db.query(`update cos_audit_log set actor = 'x'`)).rejects.toThrow(/solo de agregado/)
  })
})

describe("rechazo con motivo (0026)", () => {
  it("se puede rechazar un pendiente guardando motivos y explicación", async () => {
    const { postId } = await crearPostFasutofudo(db)
    await db.query(`update cos_posts set status = 'PENDING_APPROVAL' where id = $1 and status = 'DRAFT'`, [postId])
    await db.query(
      `update cos_posts set status = 'REJECTED', reject_reasons = $2, reject_note = $3, rejected_at = now(), rejected_by = $4 where id = $1`,
      [postId, ["texto", "voz"], "Muy formal", JAVIER],
    )
    const p = await one<{ status: string; reject_reasons: string[]; reject_note: string }>(db, `select status, reject_reasons, reject_note from cos_posts where id = $1`, [postId])
    expect(p).toEqual({ status: "REJECTED", reject_reasons: ["texto", "voz"], reject_note: "Muy formal" })
  })
})

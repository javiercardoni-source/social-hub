/**
 * Manejadores por tipo de trabajo. Todos son idempotentes: si se corren dos veces o se
 * cortan a la mitad, terminan en el mismo lugar (PLAN §6, skill make-operations-idempotent).
 *
 *   asset:process   bajar → ffprobe → miniatura → versión original → READY → encola clasificar
 *   asset:classify  fotogramas → Claude → etiquetas, calidad, alertas (y bloqueo por consentimiento)
 *   post:publish    SCHEDULED/RETRY → PUBLISHING → PUBLISHED (simulado o real)
 *   post:reconcile  un post que quedó "publicando" cuando el worker se cayó
 *
 * Un manejador tira PermanentError si reintentar no sirve; cualquier otro error vuelve
 * a la cola con espera creciente (la calcula la base).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { PermanentError, type Job, type Queue } from "./queue.ts"
import { storageFor, supabaseStorage } from "./storage.ts"
import { framesForAi, probe, sha256, thumbnail, withTmp, writeTmp } from "./media.ts"
import { classify } from "./ai.ts"
import { BLOCKING_RISK_FLAGS, type BrandContext } from "../../shared/cos/prompts.ts"

export type HandlerContext = {
  db: SupabaseClient
  queue: Queue
  log: (msg: string, extra?: Record<string, unknown>) => void
  /** Se activa cuando el worker se está apagando: los trabajos largos deberían cortar. */
  signal: AbortSignal
}
export type Handler = (job: Job, ctx: HandlerContext) => Promise<void>

const MAX_POST_ATTEMPTS = 5

// ── utilidades ──────────────────────────────────────────────────────────────
function idFrom(job: Job, key: string): string {
  const v = job.payload[key]
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/.test(v)) throw new PermanentError(`payload sin ${key} válido`)
  return v
}

async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  if (data == null) throw new PermanentError(`${what}: no existe`)
  return data
}

async function settings(db: SupabaseClient) {
  return must(
    db.from("cos_settings").select("publish_mode, storage_driver, global_pause, ai_model").eq("id", true).single(),
    "configuración",
  ) as Promise<{ publish_mode: "simulated" | "live"; storage_driver: string; global_pause: boolean; ai_model: string }>
}

async function brandContext(db: SupabaseClient, brandId: string): Promise<BrandContext> {
  const b = (await must(
    db.from("cos_brands").select("name, slug, tone_md, rules_json").eq("id", brandId).single(),
    "marca",
  )) as { name: string; slug: string; tone_md: string; rules_json: BrandContext["rules"] }
  return { name: b.name, slug: b.slug, toneMd: b.tone_md, rules: b.rules_json ?? {} }
}

type AssetRow = {
  id: string
  brand_id: string
  status: string
  description: string | null
  submitted_by_label: string | null
  mime: string | null
  media_type: "photo" | "video" | null
  storage_driver: string | null
  storage_key: string | null
  current_version_id: string | null
}
const ASSET_COLS =
  "id, brand_id, status, description, submitted_by_label, mime, media_type, storage_driver, storage_key, current_version_id"

// ── asset:process ───────────────────────────────────────────────────────────
const processAsset: Handler = async (job, { db, queue, log }) => {
  const assetId = idFrom(job, "asset_id")
  const a = (await must(db.from("cos_assets").select(ASSET_COLS).eq("id", assetId).single(), "asset")) as AssetRow
  if (!["NEW", "VALIDATING", "FAILED_PROCESSING"].includes(a.status)) {
    log("asset ya procesado, nada que hacer", { asset: a.id, status: a.status })
    return
  }
  if (!a.storage_key) throw new PermanentError("el asset no tiene archivo (storage_key vacío)")

  // Sin descripción no se sigue (no negociable del paquete).
  if ((a.description ?? "").trim().length < 15) {
    await must(db.from("cos_assets").update({ status: "MISSING_DESCRIPTION" }).eq("id", a.id).select("id").single(), "asset")
    log("sin descripción: queda esperando", { asset: a.id })
    return
  }

  await db.from("cos_assets").update({ status: "VALIDATING" }).eq("id", a.id)
  const storage = storageFor(a.storage_driver, db)
  const original = await storage.download(a.storage_key)

  const meta = await withTmp(async (dir) => {
    const file = await writeTmp(dir, "original", original)
    const info = await probe(file, a.mime)
    const thumb = await thumbnail(file, info, dir)
    return { info, thumb }
  })

  // Las miniaturas viven siempre en cos-media (son livianas y las usa la interfaz).
  const thumbKey = `thumbs/${a.id}.jpg`
  await supabaseStorage(db).upload(thumbKey, meta.thumb, "image/jpeg")

  // Versión 1 = el original. Solo se inserta si no existe (reintentos no duplican).
  let versionId = a.current_version_id
  if (!versionId) {
    const existing = await db.from("cos_asset_versions").select("id").eq("asset_id", a.id).eq("version_number", 1).maybeSingle()
    versionId = existing.data?.id ?? null
  }
  if (!versionId) {
    const v = (await must(
      db
        .from("cos_asset_versions")
        .insert({
          asset_id: a.id,
          version_number: 1,
          kind: "original",
          aspect: "orig",
          storage_driver: storage.driver,
          storage_key: a.storage_key,
          mime: a.mime,
          width: meta.info.width,
          height: meta.info.height,
          duration_ms: meta.info.durationMs,
          size_bytes: original.byteLength,
          created_by: "worker",
        })
        .select("id")
        .single(),
      "versión original",
    )) as { id: string }
    versionId = v.id
  }

  await must(
    db
      .from("cos_assets")
      .update({
        status: "READY",
        media_type: meta.info.mediaType,
        width: meta.info.width,
        height: meta.info.height,
        duration_ms: meta.info.durationMs,
        size_bytes: original.byteLength,
        sha256: sha256(original),
        thumb_key: thumbKey,
        current_version_id: versionId,
      })
      .eq("id", a.id)
      .select("id")
      .single(),
    "asset",
  )
  await queue.enqueue("asset:classify", { asset_id: a.id }, { dedupeKey: `classify:${a.id}` })
  log("asset listo", { asset: a.id, type: meta.info.mediaType, w: meta.info.width, h: meta.info.height })
}

// ── asset:classify ──────────────────────────────────────────────────────────
const classifyAsset: Handler = async (job, { db, log }) => {
  const assetId = idFrom(job, "asset_id")
  const a = (await must(db.from("cos_assets").select(ASSET_COLS).eq("id", assetId).single(), "asset")) as AssetRow
  if (!["READY", "IN_USE"].includes(a.status)) {
    log("asset no está listo para clasificar", { asset: a.id, status: a.status })
    return
  }
  const s = await settings(db)
  const brand = await brandContext(db, a.brand_id)
  const original = await storageFor(a.storage_driver, db).download(a.storage_key!)

  const frames = await withTmp(async (dir) => {
    const file = await writeTmp(dir, "original", original)
    return framesForAi(file, await probe(file, a.mime), dir)
  })

  const c = await classify({
    db,
    model: s.ai_model,
    brand,
    assetId: a.id,
    description: a.description!,
    submittedBy: a.submitted_by_label,
    mediaType: a.media_type ?? "photo",
    frames,
  })

  // Caras de clientes o menores: se bloquea hasta que una persona lo revise (la base
  // impide programar cualquier post que lo use).
  const blocked = c.risk_flags.some((f) => BLOCKING_RISK_FLAGS.includes(f))
  await must(
    db
      .from("cos_assets")
      .update({
        ai_json: c,
        quality_score: c.quality_score,
        people_present: c.people_present,
        ...(blocked ? { consent: "blocked" } : {}),
      })
      .eq("id", a.id)
      .select("id")
      .single(),
    "asset",
  )
  log("asset clasificado", { asset: a.id, quality: c.quality_score, flags: c.risk_flags, blocked })
}

// ── post:publish ────────────────────────────────────────────────────────────
type PostRow = { id: string; status: string; attempts: number; platform: string; post_type: string }

async function setPost(db: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("cos_posts").update(patch).eq("id", id)
  if (error) throw new Error(`post ${id}: ${error.message}`)
}

const publishPost: Handler = async (job, { db, log }) => {
  const postId = idFrom(job, "post_id")
  const p = (await must(
    db.from("cos_posts").select("id, status, attempts, platform, post_type").eq("id", postId).single(),
    "post",
  )) as PostRow
  // Idempotencia: solo se publica desde estos dos estados. Cualquier otro = ya se resolvió.
  if (!["SCHEDULED", "RETRY_SCHEDULED"].includes(p.status)) {
    log("post no está para publicar, nada que hacer", { post: p.id, status: p.status })
    return
  }
  const s = await settings(db)
  if (s.global_pause) {
    log("pausa general: no se publica", { post: p.id })
    return
  }

  // La base verifica acá que el contenido sea EXACTAMENTE el aprobado (y el consentimiento).
  // Si lo rechaza, no tiene sentido reintentar: vuelve a aprobación con el motivo a la vista
  // (si no, el reloj lo volvería a encolar cada minuto).
  const { error: toPublishing } = await db
    .from("cos_posts")
    .update({ status: "PUBLISHING", attempts: p.attempts + 1, last_error: null })
    .eq("id", p.id)
  if (toPublishing) {
    await setPost(db, p.id, { status: "PENDING_APPROVAL", last_error: `No se pudo publicar: ${toPublishing.message}` })
    log("la base frenó la publicación: vuelve a aprobación", { post: p.id, error: toPublishing.message })
    return
  }

  try {
    if (s.publish_mode === "simulated") {
      await new Promise((r) => setTimeout(r, 800))
      await setPost(db, p.id, {
        status: "PUBLISHED",
        simulated: true,
        remote_post_id: `simulado_${p.id}`,
        published_at: new Date().toISOString(),
      })
      log("publicado (SIMULADO: no salió a Meta)", { post: p.id })
      return
    }
    // El publicador real de Meta se escribe el día de la conexión (PLAN §9.4).
    throw new PermanentError("publicación real todavía no conectada (publish_mode = live sin adaptador de Meta)")
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const permanent = e instanceof PermanentError || p.attempts + 1 >= MAX_POST_ATTEMPTS
    await setPost(db, p.id, { status: "FAILED", last_error: message })
    if (!permanent) {
      const waitMin = 2 ** p.attempts // 1, 2, 4, 8 minutos
      await setPost(db, p.id, {
        status: "RETRY_SCHEDULED",
        next_attempt_at: new Date(Date.now() + waitMin * 60_000).toISOString(),
      })
    }
    log("la publicación falló", { post: p.id, permanent, error: message })
  }
}

// ── post:reconcile ──────────────────────────────────────────────────────────
const reconcilePost: Handler = async (job, { db, log }) => {
  const postId = idFrom(job, "post_id")
  const p = (await must(db.from("cos_posts").select("id, status, attempts, platform, post_type").eq("id", postId).single(), "post")) as PostRow
  if (p.status !== "PUBLISHING") return
  const s = await settings(db)
  if (s.publish_mode === "simulated") {
    // En simulación no hay nada afuera que consultar: se reintenta.
    await setPost(db, p.id, { status: "FAILED", last_error: "El worker se cortó mientras publicaba" })
    await setPost(db, p.id, { status: "RETRY_SCHEDULED", next_attempt_at: new Date().toISOString() })
    log("reconciliado (simulado): vuelve a intentarse", { post: p.id })
    return
  }
  // Real: consultar /{ig-user-id}/media por caption + hora antes de reintentar (PLAN §6.3).
  throw new PermanentError("reconciliación real todavía no conectada")
}

export const handlers: Record<string, Handler> = {
  // Trabajo de prueba: sirve para verificar punta a punta que la cola anda en producción.
  "system:ping": async (job, ctx) => {
    ctx.log("pong", { job: job.id })
  },
  "asset:process": processAsset,
  "asset:classify": classifyAsset,
  "post:publish": publishPost,
  "post:reconcile": reconcilePost,
}

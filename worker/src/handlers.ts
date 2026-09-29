/**
 * Manejadores por tipo de trabajo. Todos son idempotentes: si se corren dos veces o se
 * cortan a la mitad, terminan en el mismo lugar (PLAN §6, skill make-operations-idempotent).
 *
 *   asset:process   bajar → ffprobe → miniatura → versión original → READY → encola clasificar
 *   asset:classify  fotogramas → Claude → etiquetas, calidad, alertas (y bloqueo por consentimiento)
 *   asset:archive   copia el original al Drive (archivo maestro), sin duplicar
 *   post:draft      la IA escribe el texto y deja el post esperando aprobación
 *   post:redo       rehace con la IA texto/frase (y opcionalmente plantilla o tema) de una subida
 *   post:delete     borra de la red un post publicado (Facebook sí; Instagram si Meta lo permite)
 *   post:render     arma la pieza final (encuadre + plantilla de marca) que se aprueba y se publica
 *   post:publish    SCHEDULED/RETRY → PUBLISHING → PUBLISHED (simulado o real en Meta)
 *   post:reconcile  un post que quedó "publicando" cuando el worker se cayó
 *   metrics:sync    trae lo publicado y mide cada post según su edad (F1 analytics)
 *   accounts:check  prueba el token de cada cuenta y la marca conectada o con error
 *
 * Un manejador tira PermanentError si reintentar no sirve; cualquier otro error vuelve
 * a la cola con espera creciente (la calcula la base).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { PermanentError, type Job, type Queue } from "./queue.ts"
import { MEDIA_BUCKET, storageFor, supabaseStorage } from "./storage.ts"
import { fitForInstagramFeed, fitForStory, framesForAi, probe, sha256, thumbnail, toJpeg, withTmp, writeTmp } from "./media.ts"
import { classify, writeCaption } from "./ai.ts"
import { driveFromEnv, FOLDER_MIME } from "./drive.ts"
import { BASE_MIMES, BASE_MAX_BYTES, elegirTanda, esIdDrive, TIPOS, type TipoTanda } from "../../shared/cos/base-fotos.ts"
import { ensureRender, loadRenderPost, renderReviewed } from "./render.ts"
import { syncAccount } from "./metrics.ts"
import { arDay, contextForBrand, syncContext } from "./context.ts"
import { datosParaIA, normalizarDatos } from "../../shared/cos/datos-vigentes.ts"
import { ingestTurnos } from "./turnos.ts"
import { defaultTemplate, type Template } from "./overlay.ts"
import {
  checkAccount,
  deleteRemote,
  graphGet,
  findFacebookPost,
  findInstagramPost,
  isTokenError,
  publishFacebook,
  publishInstagram,
  tokenFor,
  type MediaItem,
  type PostType,
} from "./meta.ts"
import { BLOCKING_RISK_FLAGS, type BrandContext } from "../../shared/cos/prompts.ts"
import { fullCaption } from "../../shared/cos/caption.ts"

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

function driveIdFrom(job: Job, key: string): string {
  const v = job.payload[key]
  if (!esIdDrive(v)) throw new PermanentError(`payload sin ${key} de Drive válido`)
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
    db.from("cos_settings").select("publish_mode, storage_driver, global_pause, ai_model, ai_model_light").eq("id", true).single(),
    "configuración",
  ) as Promise<{ publish_mode: "simulated" | "live"; storage_driver: string; global_pause: boolean; ai_model: string; ai_model_light: string }>
}

async function brandContext(db: SupabaseClient, brandId: string): Promise<BrandContext> {
  const b = (await must(
    db.from("cos_brands").select("name, slug, tone_md, rules_json, datos_vigentes").eq("id", brandId).single(),
    "marca",
  )) as { name: string; slug: string; tone_md: string; rules_json: BrandContext["rules"]; datos_vigentes: unknown }
  const vigentes = datosParaIA(normalizarDatos(b.datos_vigentes), arDay(new Date()))
  return { name: b.name, slug: b.slug, toneMd: b.tone_md, rules: b.rules_json ?? {}, vigentes }
}

type AssetRow = {
  id: string
  brand_id: string
  status: string
  source: string
  description: string | null
  submitted_by_label: string | null
  mime: string | null
  media_type: "photo" | "video" | null
  storage_driver: string | null
  storage_key: string | null
  current_version_id: string | null
}
const ASSET_COLS =
  "id, brand_id, status, source, description, submitted_by_label, mime, media_type, storage_driver, storage_key, current_version_id"

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
  // Lo que vino de la base de fotos ya está en Drive: no se copia otra vez.
  if (driveFromEnv() && a.source !== "drive") await queue.enqueue("asset:archive", { asset_id: a.id }, { dedupeKey: `archive:${a.id}` })
  log("asset listo", { asset: a.id, type: meta.info.mediaType, w: meta.info.width, h: meta.info.height })
}

// ── asset:classify ──────────────────────────────────────────────────────────
const classifyAsset: Handler = async (job, { db, queue, log }) => {
  const assetId = idFrom(job, "asset_id")
  const a = (await must(db.from("cos_assets").select(ASSET_COLS).eq("id", assetId).single(), "asset")) as AssetRow
  if (!["READY", "IN_USE"].includes(a.status)) {
    log("asset no está listo para clasificar", { asset: a.id, status: a.status })
    return
  }
  const s = await settings(db)
  const brand = await brandContext(db, a.brand_id)
  const original = await storageFor(a.storage_driver, db).download(a.storage_key!)
  // Material de archivo (F2): modelo económico, y la IA escribe la descripción si era provisoria.
  const { data: extra } = await db.from("cos_assets").select("source, description_by_ai").eq("id", a.id).single()
  const archivo = extra?.source === "archivo" || extra?.source === "instagram"

  const frames = await withTmp(async (dir) => {
    const file = await writeTmp(dir, "original", original)
    return framesForAi(file, await probe(file, a.mime), dir)
  })

  const c = await classify({
    db,
    model: archivo ? s.ai_model_light : s.ai_model,
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
        // Descripción provisoria (nombre de carpeta/archivo): la reemplaza lo que ve la IA.
        ...(extra?.description_by_ai && c.summary.trim().length >= 15 ? { description: c.summary.trim().slice(0, 500) } : {}),
      })
      .eq("id", a.id)
      .select("id")
      .single(),
    "asset",
  )
  log("asset clasificado", { asset: a.id, quality: c.quality_score, flags: c.risk_flags, blocked })

  // Lo que manda la cocina (o se sube a mano) llega a Aprobaciones con el texto ya escrito.
  // El archivo no: espera a que Javier elija "Usar".
  if (!blocked && !archivo) await queue.enqueue("post:draft", { asset_id: a.id }, { dedupeKey: `draft:${a.id}` })
}

// ── post:draft ──────────────────────────────────────────────────────────────
const draftPost: Handler = async (job, { db, queue, log }) => {
  const assetId = idFrom(job, "asset_id")
  const a = (await must(
    db.from("cos_assets").select(`${ASSET_COLS}, source, consent, ai_json, duration_ms, review_status`).eq("id", assetId).single(),
    "asset",
  )) as AssetRow & { source: string; consent: string; ai_json: { summary?: string } | null; duration_ms: number | null; review_status: string | null }
  // Borradores: lo que manda la cocina o se sube a mano, y el archivo que Javier eligió "Usar".
  const permitido = ["manual", "turnos"].includes(a.source) || a.review_status === "approved"
  if (!permitido || a.consent === "blocked" || !a.current_version_id) {
    log("sin borrador automático para este asset", { asset: a.id, source: a.source, consent: a.consent })
    return
  }
  // Idempotencia: si ya hay posts vivos con este archivo, no se arman otros.
  const { data: existing } = await db
    .from("cos_post_media")
    .select("cos_posts!inner(status)")
    .eq("version_id", a.current_version_id)
    .not("cos_posts.status", "in", "(CANCELLED,REJECTED)")
  if (existing?.length) return

  const { data: accounts } = await db
    .from("cos_social_accounts")
    .select("id, platform")
    .eq("brand_id", a.brand_id)
    .in("platform", ["instagram", "facebook"])
    .neq("status", "disabled")
  const ig = accounts?.find((x) => x.platform === "instagram")
  const fb = accounts?.find((x) => x.platform === "facebook")
  if (!ig && !fb) {
    log("la marca no tiene cuentas conectadas: sin borrador", { asset: a.id })
    return
  }

  const s = await settings(db)
  const isVideo = a.media_type === "video"
  const c = await writeCaption({
    db,
    model: s.ai_model,
    brand: await brandContext(db, a.brand_id),
    assetId: a.id,
    platform: "instagram",
    postType: isVideo ? "reel" : "feed",
    description: a.description ?? "",
    aiSummary: a.ai_json?.summary ?? "",
    context: await contextForBrand(db, a.brand_id).catch((e) => (log("sin contexto del día", { error: String(e) }), "")),
  })
  const caption = `${c.hook.trim()}\n${c.caption.trim()}`
  const hashtags = c.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")

  // Un borrador por formato: se aprueban (o rechazan) por separado. La historia va sin texto.
  const brandSlug = (await brandContext(db, a.brand_id)).slug
  const overlay = c.overlay.replace(/[#\p{Extended_Pictographic}]/gu, "").trim().slice(0, 60)
  const template = defaultTemplate(brandSlug)
  // Foto + biblioteca de música de la marca → todo sale con música: en Instagram va como reel
  // (que también aparece en el feed) en vez de post de foto, porque Meta no deja música en fotos.
  const music = await listMusic(db, brandSlug)
  const pick = music.length ? music[Math.floor(Math.random() * music.length)] : null
  const withMusic = !isVideo && !!pick
  const formats: { account: string; platform: string; post_type: PostType; caption: string; hashtags: string }[] = []
  if (ig) {
    // Foto: siempre el post de foto (sin música: la API no lo permite). Con biblioteca de música,
    // además el reel con música; se pueden publicar en momentos distintos.
    formats.push({ account: ig.id, platform: "instagram", post_type: isVideo ? "reel" : "feed", caption, hashtags })
    if (withMusic) formats.push({ account: ig.id, platform: "instagram", post_type: "reel", caption, hashtags })
    // Instagram no acepta historias de más de 60 s.
    const longVideo = isVideo && (a.duration_ms ?? 0) > 60_000
    if (!longVideo) formats.push({ account: ig.id, platform: "instagram", post_type: "story", caption: "", hashtags: "" })
  }
  if (fb) formats.push({ account: fb.id, platform: "facebook", post_type: "feed", caption, hashtags })


  const created: string[] = []
  for (const f of formats) {
    const post = (await must(
      db
        .from("cos_posts")
        .insert({
          brand_id: a.brand_id,
          account_id: f.account,
          platform: f.platform,
          post_type: f.post_type,
          caption: f.caption,
          hashtags: f.hashtags,
          overlay_text: overlay,
          template,
          music_key: withMusic && !(f.platform === "instagram" && f.post_type === "feed") ? pick : null,
          status: "DRAFT",
        })
        .select("id")
        .single(),
      "post",
    )) as { id: string }
    await must(
      db.from("cos_post_media").insert({ post_id: post.id, version_id: a.current_version_id, position: 0 }).select("post_id").single(),
      "archivo del post",
    )
    await setPost(db, post.id, { status: "PENDING_APPROVAL" })
    await queue.enqueue("post:render", { post_id: post.id }, { dedupeKey: `render:${post.id}` })
    created.push(`${f.platform}:${f.post_type}`)
  }
  await db.from("cos_audit_log").insert({
    event: "post:drafted",
    entity_type: "asset",
    entity_id: a.id,
    actor: "worker",
    details_json: { formats: created, rationale: c.rationale },
  })
  log("borradores listos para aprobar", { asset: a.id, formats: created })
}

// ── biblioteca de música (cos-media/music/<marca>/, la carga scripts/musica-subir.mjs) ──
async function listMusic(db: SupabaseClient, slug: string): Promise<string[]> {
  const { data } = await db.storage.from(MEDIA_BUCKET).list(`music/${slug}`, { limit: 100 })
  return (data ?? []).filter((f) => /\.(mp3|m4a|wav|aac)$/i.test(f.name)).map((f) => `music/${slug}/${f.name}`)
}

// ── asset:archive ───────────────────────────────────────────────────────────
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic",
  "video/mp4": "mp4", "video/quicktime": "mov",
}

const archiveAsset: Handler = async (job, { db, log }) => {
  const drive = driveFromEnv()
  if (!drive) throw new PermanentError("Drive no está configurado en el servidor")
  const assetId = idFrom(job, "asset_id")
  const a = (await must(
    db.from("cos_assets").select(`${ASSET_COLS}, drive_file_id, created_at, cos_brands(slug)`).eq("id", assetId).single(),
    "asset",
  )) as AssetRow & { drive_file_id: string | null; created_at: string; cos_brands: { slug: string } | null }
  if (a.drive_file_id) return
  if (!a.storage_key) throw new PermanentError("el asset no tiene archivo")

  // Si un intento anterior lo subió pero no llegó a guardar el id, se adopta ese archivo.
  let file = await drive.findByAsset(a.id)
  if (!file) {
    const data = await storageFor(a.storage_driver, db).download(a.storage_key)
    const mime = a.mime ?? "application/octet-stream"
    const month = a.created_at.slice(0, 7)
    file = await drive.upload({
      folderPath: ["10_ORIGINALS", a.cos_brands?.slug ?? "sin-marca", month],
      name: `${a.created_at.slice(0, 10)}_${a.id.slice(0, 8)}.${EXT[mime] ?? "bin"}`,
      mime,
      data,
      appProperties: { cos_asset_id: a.id },
    })
  }
  await must(
    db.from("cos_assets").update({ drive_file_id: file.id, drive_md5: file.md5Checksum ?? null }).eq("id", a.id).select("id").single(),
    "asset",
  )
  log("original archivado en Drive", { asset: a.id, drive: file.id })
}

// ── post:publish ────────────────────────────────────────────────────────────
type PostRow = {
  id: string
  status: string
  attempts: number
  platform: string
  post_type: PostType
  caption: string
  hashtags: string
  remote_container_id: string | null
  remote_post_id: string | null
  updated_at: string
  cos_social_accounts: { id: string; external_id: string; token_ref: string | null } | null
}
const POST_COLS =
  "id, status, attempts, platform, post_type, caption, hashtags, remote_container_id, remote_post_id, updated_at, cos_social_accounts(id, external_id, token_ref)"

async function setPost(db: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("cos_posts").update(patch).eq("id", id)
  if (error) throw new Error(`post ${id}: ${error.message}`)
}

async function loadPost(db: SupabaseClient, id: string): Promise<PostRow> {
  return (await must(db.from("cos_posts").select(POST_COLS).eq("id", id).single(), "post")) as unknown as PostRow
}

type VersionRow = { id: string; storage_driver: string; storage_key: string | null; drive_file_id: string | null; mime: string | null }

/**
 * URL pública (1 h) de cada archivo del post, en orden. Las fotos que no son JPEG se
 * convierten, y lo que vive solo en Drive se copia a cos-media/staging (Meta necesita
 * poder bajarlo por HTTP).
 */
async function mediaUrls(
  db: SupabaseClient,
  postId: string,
  attempt: number,
  target: { platform: string; postType: PostType },
): Promise<{ items: MediaItem[]; staged: string[] }> {
  // El feed de Instagram exige proporción entre 4:5 y 1,91:1, y la historia 9:16: esas fotos
  // siempre pasan por ajuste (sin recortar: se completa con fondo desenfocado).
  const igFeed = target.platform === "instagram" && (target.postType === "feed" || target.postType === "carousel")
  const story = target.postType === "story"
  const rows = (await must(
    db
      .from("cos_post_media")
      .select("position, cos_asset_versions(id, storage_driver, storage_key, drive_file_id, mime)")
      .eq("post_id", postId)
      .order("position"),
    "archivos del post",
  )) as unknown as { position: number; cos_asset_versions: VersionRow }[]
  if (rows.length === 0) throw new PermanentError("el post no tiene archivos")

  const media = supabaseStorage(db)
  const items: MediaItem[] = []
  const staged: string[] = []
  for (const { position, cos_asset_versions: v } of rows) {
    const kind = v.mime?.startsWith("video/") ? "video" : "photo"
    const onSupabase = v.storage_driver === "supabase" && v.storage_key
    const isJpeg = v.mime === "image/jpeg"
    if (onSupabase && (kind === "video" || (isJpeg && !igFeed && !story))) {
      items.push({ kind, url: await media.signedUrl(v.storage_key!, 3600) })
      continue
    }
    const original = onSupabase
      ? await media.download(v.storage_key!)
      : await storageFor("drive", db).download(v.drive_file_id ?? v.storage_key!)
    const data =
      kind !== "photo"
        ? original
        : await withTmp(async (dir) => {
            const f = await writeTmp(dir, "in", original)
            return story ? fitForStory(f, dir) : igFeed ? fitForInstagramFeed(f, dir) : isJpeg ? original : toJpeg(f, dir)
          })
    const ext = kind === "photo" ? "jpg" : (EXT[v.mime ?? ""] ?? "mp4")
    const key = `staging/${postId}/${attempt}-${position}.${ext}`
    await media.upload(key, data, kind === "photo" ? "image/jpeg" : (v.mime ?? "video/mp4"))
    staged.push(key)
    items.push({ kind, url: await media.signedUrl(key, 3600) })
  }
  return { items, staged }
}

async function markAccount(db: SupabaseClient, accountId: string, ok: boolean, error: string | null) {
  await db
    .from("cos_social_accounts")
    .update({ status: ok ? "connected" : "error", last_error: error, last_checked_at: new Date().toISOString() })
    .eq("id", accountId)
}

const publishPost: Handler = async (job, { db, log, signal }) => {
  const postId = idFrom(job, "post_id")
  const p = await loadPost(db, postId)
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
  const attempt = p.attempts + 1
  const { error: toPublishing } = await db
    .from("cos_posts")
    .update({ status: "PUBLISHING", attempts: attempt, last_error: null })
    .eq("id", p.id)
  if (toPublishing) {
    await setPost(db, p.id, { status: "PENDING_APPROVAL", last_error: `No se pudo publicar: ${toPublishing.message}` })
    log("la base frenó la publicación: vuelve a aprobación", { post: p.id, error: toPublishing.message })
    return
  }

  const account = p.cos_social_accounts
  let staged: string[] = []
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

    if (!account) throw new PermanentError("el post no tiene cuenta asignada")
    const token = tokenFor(account.token_ref)
    const caption = fullCaption(p.caption, p.hashtags)
    // Posts de un solo archivo: se publica la pieza final (la misma que se vio al aprobar).
    let prepared: { items: MediaItem[]; staged: string[] }
    const rp = p.post_type === "carousel" ? null : await loadRenderPost(db, p.id)
    const key = rp ? await ensureRender(db, rp) : null
    if (rp && key) {
      const kind = key.endsWith(".mp4") ? "video" : "photo"
      prepared = { items: [{ kind, url: await supabaseStorage(db).signedUrl(key, 3600) }], staged: [] }
    } else {
      prepared = await mediaUrls(db, p.id, attempt, { platform: p.platform, postType: p.post_type })
    }
    staged = prepared.staged

    const result =
      p.platform === "instagram"
        ? await publishInstagram({
            igUserId: account.external_id,
            token,
            type: p.post_type,
            caption,
            media: prepared.items,
            existingContainerId: p.remote_container_id,
            saveContainer: (id) => setPost(db, p.id, { remote_container_id: id }),
            signal,
          })
        : p.platform === "facebook"
          ? await publishFacebook({ pageId: account.external_id, token, type: p.post_type, caption, media: prepared.items })
          : (() => {
              throw new PermanentError(`${p.platform} todavía no está soportado`)
            })()

    // El id se guarda apenas se tiene: es lo que impide publicar dos veces.
    await setPost(db, p.id, {
      status: "PUBLISHED",
      simulated: false,
      remote_post_id: result.remoteId,
      permalink: result.permalink,
      published_at: new Date().toISOString(),
    })
    await markAccount(db, account.id, true, null)
    log("PUBLICADO en Meta", { post: p.id, platform: p.platform, remote: result.remoteId, permalink: result.permalink })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (account && isTokenError(e)) await markAccount(db, account.id, false, message)
    const permanent = e instanceof PermanentError || attempt >= MAX_POST_ATTEMPTS
    await setPost(db, p.id, { status: "FAILED", last_error: message })
    if (!permanent) {
      const waitMin = 2 ** p.attempts // 1, 2, 4, 8 minutos
      await setPost(db, p.id, {
        status: "RETRY_SCHEDULED",
        next_attempt_at: new Date(Date.now() + waitMin * 60_000).toISOString(),
      })
    }
    log("la publicación falló", { post: p.id, permanent, error: message })
  } finally {
    // Las copias temporales para Meta ya no hacen falta (el original sigue guardado).
    if (staged.length) {
      const { error: rmErr } = await db.storage.from(MEDIA_BUCKET).remove(staged)
      if (rmErr) log("no se pudieron borrar las copias temporales", { post: p.id, files: staged, error: rmErr.message })
    }
  }
}

// ── post:render ─────────────────────────────────────────────────────────────
const renderPost: Handler = async (job, { db, log }) => {
  const postId = idFrom(job, "post_id")
  const s = await settings(db)
  // Si lo editan mientras se arma, se vuelve a armar con lo último (nunca queda una pieza vieja).
  for (let i = 0; i < 3; i++) {
    const p = await loadRenderPost(db, postId)
    if (["PUBLISHED", "PUBLISHING", "CANCELLED", "REJECTED"].includes(p.status)) return
    // Ya resuelta y revisada (o aprobada): solo se asegura que exista, sin volver a decidir.
    if (p.overlay_layout && p.render_qa) {
      const key = await ensureRender(db, p)
      if (key !== p.render_key) await setPost(db, postId, { render_key: key })
      return
    }
    const r = await renderReviewed(db, p, s.ai_model)
    const now = await loadRenderPost(db, postId)
    const changed =
      now.template !== p.template || now.overlay_text !== p.overlay_text || now.music_key !== p.music_key || now.overlay_position !== p.overlay_position
    if (changed) continue
    await setPost(db, postId, { render_key: r.key, overlay_layout: r.layout, render_qa: r.qa })
    log("pieza final lista", { post: postId, key: r.key, layout: r.layout, qa: r.qa })
    return
  }
  throw new Error("el post cambió varias veces mientras se armaba la pieza: se reintenta")
}

// ── post:redo ───────────────────────────────────────────────────────────────
/**
 * Rehace con la IA los borradores de una subida: texto y frase nuevos (distintos al anterior,
 * siguiendo el pedido de quien aprueba) y, si se pide, otra plantilla u otro tema.
 * Solo toca posts que siguen esperando aprobación.
 */
const redoPosts: Handler = async (job, { db, queue, log }) => {
  const ids = job.payload.post_ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => typeof x !== "string")) throw new PermanentError("payload sin post_ids")
  const request = typeof job.payload.request === "string" ? job.payload.request.slice(0, 500) : ""
  const otroDiseno = job.payload.otro_diseno === true
  const otraMusica = job.payload.otra_musica === true

  const { data, error } = await db
    .from("cos_posts")
    .select(
      `id, status, platform, post_type, caption, overlay_text, template, music_key, brand_id,
       cos_post_media(position, cos_asset_versions(cos_assets!cos_asset_versions_asset_id_fkey(id, description, ai_json)))`,
    )
    .in("id", ids as string[])
    .eq("status", "PENDING_APPROVAL")
  if (error) throw new Error(`posts: ${error.message}`)
  const posts = (data ?? []) as unknown as {
    id: string
    platform: string
    post_type: PostType
    caption: string
    overlay_text: string
    template: Template
    music_key: string | null
    brand_id: string
    cos_post_media: { position: number; cos_asset_versions: { cos_assets: { id: string; description: string | null; ai_json: { summary?: string } | null } | null } | null }[]
  }[]
  if (!posts.length) return
  const first = posts.find((p) => p.post_type !== "story") ?? posts[0]
  const asset = first.cos_post_media[0]?.cos_asset_versions?.cos_assets
  if (!asset) throw new PermanentError("el post no tiene archivo")

  const s = await settings(db)
  const brand = await brandContext(db, first.brand_id)
  const c = await writeCaption({
    db,
    model: s.ai_model,
    brand,
    assetId: asset.id,
    platform: "instagram",
    postType: first.post_type === "story" ? "feed" : first.post_type,
    description: asset.description ?? "",
    aiSummary: asset.ai_json?.summary ?? "",
    request,
    previous: { caption: first.caption, overlay: first.overlay_text },
    context: await contextForBrand(db, first.brand_id).catch((e) => (log("sin contexto del día", { error: String(e) }), "")),
  })
  const caption = `${c.hook.trim()}\n${c.caption.trim()}`
  const hashtags = c.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")
  const overlay = c.overlay.replace(/[#\p{Extended_Pictographic}]/gu, "").trim().slice(0, 60)

  // Otro diseño: la siguiente plantilla con texto (banda ↔ etiqueta), así se nota el cambio.
  const nextTemplate = (t: Template): Template => (t === "banda" ? "etiqueta" : "banda")
  const music = otraMusica ? await listMusic(db, brand.slug) : []

  for (const p of posts) {
    const nextMusic =
      otraMusica && p.music_key && music.length > 1
        ? music.filter((m) => m !== p.music_key)[Math.floor(Math.random() * (music.length - 1))]
        : p.music_key
    await setPost(db, p.id, {
      caption: p.post_type === "story" ? "" : caption,
      hashtags: p.post_type === "story" ? "" : hashtags,
      overlay_text: overlay,
      template: otroDiseno ? nextTemplate(p.template) : p.template,
      music_key: nextMusic,
      render_key: null,
      // Contenido nuevo: la posición se vuelve a decidir con la revisión visual.
      overlay_layout: null,
      render_qa: null,
    })
    await queue.enqueue("post:render", { post_id: p.id })
  }
  await db.from("cos_audit_log").insert({
    event: "post:redone",
    entity_type: "asset",
    entity_id: asset.id,
    actor: "worker",
    details_json: { posts: posts.map((p) => p.id), request, otroDiseno, otraMusica, rationale: c.rationale },
  })
  log("rehecho con IA", { asset: asset.id, posts: posts.length, otroDiseno, otraMusica })
}

// ── metrics:sync ────────────────────────────────────────────────────────────
const syncMetrics: Handler = async (job, { db, queue, log }) => {
  const accountId = idFrom(job, "account_id")
  const { data: acc, error } = await db
    .from("cos_social_accounts")
    .select("id, brand_id, platform, external_id, token_ref, status, metrics_backfill_cursor, metrics_backfill_done")
    .eq("id", accountId)
    .single()
  if (error || !acc) throw new PermanentError(`cuenta ${accountId}: ${error?.message ?? "no existe"}`)
  if (acc.status === "disabled" || !["instagram", "facebook"].includes(acc.platform)) return
  // Una sola corrida por cuenta a la vez (el reloj y la continuación pueden coincidir).
  const { data: running } = await db
    .from("cos_jobs")
    .select("id")
    .eq("type", "metrics:sync")
    .eq("status", "running")
    .eq("payload->>account_id", acc.id)
    .neq("id", job.id)
    .limit(1)
  if (running?.length) {
    log("ya hay una sincronización de esta cuenta en curso: esta se saltea", { account: acc.id })
    return
  }
  const r = await syncAccount(db, acc as Parameters<typeof syncAccount>[1], log)
  log("métricas sincronizadas", { account: acc.id, platform: acc.platform, ...r })
  // Queda histórico o mediciones pendientes: sigue en un rato (clave única por minuto).
  if (r.more) {
    const at = new Date(Date.now() + 90_000)
    await queue.enqueue("metrics:sync", { account_id: acc.id }, { runAt: at, dedupeKey: `metrics:${acc.id}:more:${at.toISOString().slice(0, 16)}` })
  }
}

// ── context:sync (F4) ──────────────────────────────────────────────────────
const syncContextJob: Handler = async (_job, { db, log }) => {
  const r = await syncContext(db)
  log("contexto sincronizado", r)
}

// ── archive:import-ig (F2) ─────────────────────────────────────────────────
/** Trae en alta calidad una publicación ya hecha en Instagram y la suma al Archivo. */
const importInstagram: Handler = async (job, { db, queue, log }) => {
  const mediaId = idFrom(job, "media_id")
  const { data: m, error } = await db
    .from("cos_media")
    .select("id, brand_id, remote_id, format, caption, permalink, posted_at, metrics, cos_social_accounts(token_ref, platform)")
    .eq("id", mediaId)
    .single()
  if (error || !m) throw new PermanentError(`publicación ${mediaId}: ${error?.message ?? "no existe"}`)
  const acc = m.cos_social_accounts as unknown as { token_ref: string | null; platform: string } | null
  if (acc?.platform !== "instagram" || m.format === "story") return
  // Idempotencia: la clave natural es el id de Instagram.
  const { data: ya } = await db.from("cos_assets").select("id").eq("source", "instagram").eq("source_external_id", m.remote_id).maybeSingle()
  if (ya) return

  const r = await graphGet<{ media_type?: string; media_url?: string; children?: { data?: { media_type?: string; media_url?: string }[] } }>(
    m.remote_id,
    tokenFor(acc.token_ref),
    { fields: "media_type,media_url,children{media_type,media_url}" },
  )
  // Carrusel: se toma la primera pieza (las demás se pueden sumar después si hace falta).
  const src = r.media_type === "CAROUSEL_ALBUM" ? r.children?.data?.[0] : r
  if (!src?.media_url) {
    log("la publicación no tiene archivo descargable (se saltea)", { media: m.id })
    return
  }
  const res = await fetch(src.media_url)
  if (!res.ok) throw new Error(`descarga ${res.status}`)
  const data = Buffer.from(await res.arrayBuffer())
  const isVideo = src.media_type === "VIDEO"
  const mime = isVideo ? "video/mp4" : "image/jpeg"
  const { data: brand } = await db.from("cos_brands").select("slug").eq("id", m.brand_id).single()
  const key = `originals/${brand?.slug ?? "sin-marca"}/instagram/${m.remote_id}.${isVideo ? "mp4" : "jpg"}`
  await supabaseStorage(db).upload(key, data, mime)

  const fecha = new Date(m.posted_at).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "short", year: "numeric" })
  const caption = (m.caption ?? "").replace(/\s+/g, " ").trim()
  const description = `Publicado en Instagram el ${fecha}${caption ? `: ${caption}` : ""}`.slice(0, 500)
  const { data: asset, error: ae } = await db
    .from("cos_assets")
    .insert({
      brand_id: m.brand_id,
      source: "instagram",
      source_external_id: m.remote_id,
      description,
      submitted_by_label: "Archivo de Instagram",
      mime,
      size_bytes: data.byteLength,
      storage_driver: "supabase",
      storage_key: key,
      status: "NEW",
      review_status: "pending",
      origin_path: m.permalink,
      origin_media_id: m.id,
    })
    .select("id")
    .single()
  if (ae || !asset) throw new Error(`asset: ${ae?.message}`)
  await queue.enqueue("asset:process", { asset_id: asset.id }, { dedupeKey: `process:${asset.id}` })
  log("importado de Instagram al Archivo", { media: m.id, asset: asset.id })
}

// ── archive:scan-drive (base de fotos) ──────────────────────────────────────
const BASE_SPACING_MS = 20_000 // una foto cada 20 s: la IA analiza de a poco

/** Guarda cómo quedó la última tanda (lo muestra la pantalla de Archivo). */
async function setBaseEstado(db: SupabaseClient, brandId: string, estado: Record<string, unknown>) {
  await db.from("cos_brands").update({ base_estado: { at: new Date().toISOString(), ...estado } }).eq("id", brandId)
}

/**
 * Recorre la base de fotos de la marca y encola la próxima tanda (los más nuevos primero).
 * Solo lee: nunca mueve ni borra nada en Drive.
 */
const scanDrive: Handler = async (job, { db, queue, log }) => {
  const brandId = idFrom(job, "brand_id")
  const limite = Math.min(200, Math.max(1, Number(job.payload.limite) || 50))
  const tipo: TipoTanda = TIPOS.includes(job.payload.tipo as TipoTanda) ? (job.payload.tipo as TipoTanda) : "todo"
  const drive = driveFromEnv()
  if (!drive) throw new PermanentError("Drive no está conectado en el servidor")
  const { data: b, error } = await db.from("cos_brands").select("id, slug, base_folder_id, base_folders").eq("id", brandId).single()
  if (error || !b) throw new PermanentError(`marca ${brandId}: ${error?.message ?? "no existe"}`)

  // Carpetas de la marca: la lista (varias) o, si está vacía, la única de antes o la de Content OS.
  const lista = (Array.isArray(b.base_folders) ? b.base_folders : []) as { id: string; name?: string | null }[]
  const carpetas: { id: string; name: string }[] = []
  try {
    if (lista.length) {
      for (const c of lista) {
        let m: Awaited<ReturnType<typeof drive.meta>>
        try {
          m = await drive.meta(c.id)
        } catch (e) {
          throw new Error(`«${c.name ?? c.id}»: ${e instanceof Error ? e.message : String(e)}`)
        }
        if (m.mimeType !== FOLDER_MIME) throw new PermanentError(`«${m.name}» no es una carpeta`)
        carpetas.push({ id: c.id, name: m.name })
      }
      // Se guardan los nombres reales (desde la web solo se conoce el link).
      await db.from("cos_brands").update({ base_folders: carpetas }).eq("id", brandId)
    } else if (b.base_folder_id) {
      const m = await drive.meta(b.base_folder_id)
      if (m.mimeType !== FOLDER_MIME) throw new PermanentError("el link no es de una carpeta")
      carpetas.push({ id: b.base_folder_id, name: m.name })
    } else {
      carpetas.push({ id: await drive.path(["00_BASE", b.slug]), name: `Content OS/00_BASE/${b.slug}` })
    }
    if (!lista.length) await db.from("cos_brands").update({ base_folder_id: carpetas[0].id, base_folder_name: carpetas[0].name }).eq("id", brandId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const permiso = /403|404|insufficient|scope/i.test(msg)
    await setBaseEstado(db, brandId, {
      error: permiso
        ? `No puedo ver una de las carpetas (${msg.slice(0, 80)}). Compartila con javiercardonibetti@gmail.com (lector alcanza).`
        : `No pude abrir la carpeta: ${msg.slice(0, 200)}`,
    })
    log("base de fotos: no se pudo abrir la carpeta", { brand: brandId, error: msg })
    return
  }

  // Todas las carpetas juntas; si una está dentro de otra, cada archivo cuenta una vez.
  const porId = new Map<string, Awaited<ReturnType<typeof drive.listTree>>[number]>()
  try {
    for (const c of carpetas) {
      for (const f of await drive.listTree(c.id)) {
        if (!porId.has(f.id)) porId.set(f.id, { ...f, path: f.path ? `${c.name}/${f.path}` : c.name })
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await setBaseEstado(db, brandId, { error: `No pude recorrer la carpeta (${msg.slice(0, 160)}). Se reintenta sola en unos minutos.` })
    throw e
  }
  const archivos = [...porId.values()]
  // Ya traídos (paginado: pueden ser miles) y en camino (trabajos en la cola).
  const ya = new Set<string>()
  const md5Traidos = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("cos_assets")
      .select("source, source_external_id, origin_md5")
      .eq("brand_id", brandId)
      .or("source.eq.drive,origin_md5.not.is.null")
      .range(from, from + 999)
    for (const r of data ?? []) {
      if (r.source === "drive" && r.source_external_id) ya.add(r.source_external_id)
      if (r.origin_md5) md5Traidos.add(r.origin_md5)
    }
    if (!data || data.length < 1000) break
  }
  const { data: cola } = await db
    .from("cos_jobs")
    .select("payload, run_at")
    .eq("type", "archive:import-drive-file")
    .in("status", ["queued", "running"])
  const enCamino = new Set((cola ?? []).map((j) => (j.payload as { file_id?: string }).file_id).filter(Boolean) as string[])

  const t = elegirTanda(archivos, ya, enCamino, limite, tipo, md5Traidos)
  // La tanda nueva arranca después de la última ya programada (de cualquier marca).
  let at = Math.max(Date.now(), ...(cola ?? []).map((j) => new Date(j.run_at as string).getTime()))
  for (const f of t.elegidos) {
    at += BASE_SPACING_MS
    await queue.enqueue(
      "archive:import-drive-file",
      { brand_id: brandId, file_id: f.id, path: f.path, name: f.name },
      { runAt: new Date(at), dedupeKey: `import-drive:${f.id}` },
    )
  }
  await setBaseEstado(db, brandId, {
    error: null,
    pedidos: t.elegidos.length,
    tipo,
    total: t.total,
    fotos: t.fotos,
    videos: t.videos,
    ya_traidos: t.yaTraidos,
    en_camino: enCamino.size + t.elegidos.length,
    quedan: t.quedan,
    pesados: t.pesados,
    no_soportados: t.noSoportados,
    repetidos: t.repetidos,
    carpetas: carpetas.length,
    termina: new Date(at).toISOString(),
  })
  log("base de fotos: tanda encolada", { brand: brandId, pedidos: t.elegidos.length, quedan: t.quedan })
}

// ── archive:import-drive-file ───────────────────────────────────────────────
/** Trae un archivo de la base de fotos al Archivo (copia en cos-media; el original queda en Drive). */
const importDriveFile: Handler = async (job, { db, queue, log }) => {
  const brandId = idFrom(job, "brand_id")
  const fileId = driveIdFrom(job, "file_id")
  const ruta = typeof job.payload.path === "string" ? job.payload.path : ""
  const { data: ya } = await db.from("cos_assets").select("id").eq("source", "drive").eq("source_external_id", fileId).maybeSingle()
  if (ya) return
  const drive = driveFromEnv()
  if (!drive) throw new Error("Drive no está conectado en el servidor")
  const f = await drive.meta(fileId)
  const ext = BASE_MIMES[f.mimeType]
  if (!ext) return log("base de fotos: formato no soportado (se saltea)", { file: fileId, mime: f.mimeType })
  if (Number(f.size ?? 0) > BASE_MAX_BYTES) return log("base de fotos: demasiado pesado (se saltea)", { file: fileId, size: f.size })
  if (f.md5Checksum) {
    const { data: copia } = await db.from("cos_assets").select("id").eq("brand_id", brandId).eq("origin_md5", f.md5Checksum).limit(1)
    if (copia?.length) return log("base de fotos: copia idéntica de algo ya traído (se saltea)", { file: fileId })
  }

  const data = await drive.download(fileId)
  const { data: brand } = await db.from("cos_brands").select("slug").eq("id", brandId).single()
  const key = `originals/${brand?.slug ?? "sin-marca"}/drive/${fileId}.${ext}`
  await supabaseStorage(db).upload(key, data, f.mimeType === "image/heif" ? "image/heic" : f.mimeType)
  const origen = ruta ? `${ruta}/${f.name}` : f.name
  const { data: asset, error } = await db
    .from("cos_assets")
    .insert({
      brand_id: brandId,
      source: "drive",
      source_external_id: fileId,
      // Provisoria: la IA la reemplaza con lo que ve. El nombre de la carpeta le da contexto.
      description: `Base de fotos: ${origen}`.slice(0, 300),
      description_by_ai: true,
      submitted_by_label: "Base de fotos",
      mime: f.mimeType === "image/heif" ? "image/heic" : f.mimeType,
      size_bytes: data.byteLength,
      storage_driver: "supabase",
      storage_key: key,
      status: "NEW",
      review_status: "pending",
      origin_path: origen.slice(0, 500),
      origin_md5: f.md5Checksum ?? null,
    })
    .select("id")
    .single()
  if (error || !asset) {
    // Otra corrida lo insertó justo antes (clave única): no es un error.
    if (error?.code === "23505") return
    throw new Error(`asset: ${error?.message}`)
  }
  await queue.enqueue("asset:process", { asset_id: asset.id }, { dedupeKey: `process:${asset.id}` })
  log("base de fotos: traído al Archivo", { brand: brandId, file: fileId, asset: asset.id })
}

// ── ingest:turnos (F3) ─────────────────────────────────────────────────────
const ingestTurnosJob: Handler = async (_job, { db, queue, log }) => {
  const r = await ingestTurnos(db, queue, log)
  if (r.tomadas) log("historias de Turnos ingresadas", r)
}

// ── post:delete ─────────────────────────────────────────────────────────────
const deletePost: Handler = async (job, { db, log }) => {
  const postId = idFrom(job, "post_id")
  const { data, error } = await db
    .from("cos_posts")
    .select("id, status, remote_post_id, deleted_at, delete_requested_at, simulated, cos_social_accounts(token_ref)")
    .eq("id", postId)
    .single()
  if (error || !data) throw new Error(`post ${postId}: ${error?.message ?? "no existe"}`)
  const p = data as unknown as {
    id: string
    status: string
    remote_post_id: string | null
    deleted_at: string | null
    delete_requested_at: string | null
    simulated: boolean
    cos_social_accounts: { token_ref: string | null } | null
  }
  if (p.deleted_at || !p.delete_requested_at || p.status !== "PUBLISHED") return
  try {
    if (!p.remote_post_id || p.simulated) throw new PermanentError("este post no tiene publicación real para borrar")
    const r = await deleteRemote(p.remote_post_id, tokenFor(p.cos_social_accounts?.token_ref ?? null))
    await setPost(db, p.id, { deleted_at: new Date().toISOString(), delete_error: null })
    log(r === "deleted" ? "BORRADO de Meta" : "ya no estaba en Meta: marcado como borrado", { post: p.id })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // Si no se puede borrar, se libera el pedido para que el botón vuelva a estar disponible.
    await setPost(db, p.id, { delete_error: message, delete_requested_at: null })
    log("no se pudo borrar", { post: p.id, error: message })
    if (!(e instanceof PermanentError)) throw e
  }
}

// ── post:reconcile ──────────────────────────────────────────────────────────
const reconcilePost: Handler = async (job, { db, log }) => {
  const postId = idFrom(job, "post_id")
  const p = await loadPost(db, postId)
  if (p.status !== "PUBLISHING") return
  const s = await settings(db)
  const retry = async (why: string) => {
    await setPost(db, p.id, { status: "FAILED", last_error: why })
    await setPost(db, p.id, { status: "RETRY_SCHEDULED", next_attempt_at: new Date().toISOString() })
  }
  if (s.publish_mode === "simulated") {
    // En simulación no hay nada afuera que consultar: se reintenta.
    await retry("El worker se cortó mientras publicaba")
    log("reconciliado (simulado): vuelve a intentarse", { post: p.id })
    return
  }

  // Antes de reintentar, fijarse si en realidad salió (PLAN §6.3): texto exacto + hora.
  const account = p.cos_social_accounts
  if (!account) throw new PermanentError("el post no tiene cuenta asignada")
  const token = tokenFor(account.token_ref)
  const caption = fullCaption(p.caption, p.hashtags)
  const around = new Date(p.updated_at)
  const found =
    p.platform === "instagram"
      ? await findInstagramPost(account.external_id, token, caption, around).then((m) => m && { id: m.id, permalink: m.permalink })
      : await findFacebookPost(account.external_id, token, caption, around).then((m) => m && { id: m.id, permalink: m.permalink_url })
  if (found) {
    const permalink = found.permalink
    await setPost(db, p.id, {
      status: "PUBLISHED",
      simulated: false,
      remote_post_id: found.id,
      permalink: permalink ?? null,
      published_at: new Date().toISOString(),
    })
    log("reconciliado: ya estaba publicado, se adopta", { post: p.id, remote: found.id })
    return
  }
  await retry("El worker se cortó mientras publicaba (no salió: se reintenta)")
  log("reconciliado: no había salido, vuelve a intentarse", { post: p.id })
}

// ── accounts:check ──────────────────────────────────────────────────────────
const checkAccounts: Handler = async (_job, { db, log }) => {
  const { data, error } = await db
    .from("cos_social_accounts")
    .select("id, platform, external_id, token_ref")
    .neq("status", "disabled")
  if (error) throw new Error(`cuentas: ${error.message}`)
  for (const a of data ?? []) {
    try {
      const name = await checkAccount(a.platform, a.external_id, tokenFor(a.token_ref))
      await markAccount(db, a.id, true, null)
      log("cuenta OK", { account: a.id, name })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await markAccount(db, a.id, false, message)
      log("cuenta con error", { account: a.id, error: message })
    }
  }
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
  "asset:archive": archiveAsset,
  "post:draft": draftPost,
  "post:render": renderPost,
  "post:delete": deletePost,
  "post:redo": redoPosts,
  "metrics:sync": syncMetrics,
  "context:sync": syncContextJob,
  "archive:import-ig": importInstagram,
  "archive:scan-drive": scanDrive,
  "archive:import-drive-file": importDriveFile,
  "ingest:turnos": ingestTurnosJob,
  "accounts:check": checkAccounts,
}

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
 *   music:* / traits:backfill  fichas del motor de gustos (F7), en gustos.ts
 *
 * Un manejador tira PermanentError si reintentar no sirve; cualquier otro error vuelve
 * a la cola con espera creciente (la calcula la base).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { PermanentError, type Job, type Queue } from "./queue.ts"
import { MEDIA_BUCKET, storageFor, supabaseStorage } from "./storage.ts"
import { compactVideo, framesAt, grillaImagen, placaFondo, sceneCuts, fitForInstagramFeed, fitForStory, framesForAi, probe, sha256, thumbnail, toJpeg, UPLOAD_MAX_BYTES, withTmp, writeTmp } from "./media.ts"
import { analyzeGrid, analyzeReference, classify, writeCaption, writeHolidayPhrase } from "./ai.ts"
import { driveFromEnv, FOLDER_MIME } from "./drive.ts"
import { BASE_MIMES, BASE_MAX_BYTES, elegirTanda, esIdDrive, TIPOS, type TipoTanda } from "../../shared/cos/base-fotos.ts"
import { ensureRender, exists, loadRenderPost, renderReviewed } from "./render.ts"
import { syncAccount } from "./metrics.ts"
import { arDay, climaParaHoy, contextForBrand, syncContext } from "./context.ts"
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
import { DIAS_ANTICIPACION, campaniaFeriado, consignaFeriado, diasAntesDe, horaBA, planFeriado } from "../../shared/cos/feriados.ts"
import { openDays } from "../../shared/cos/timing.ts"
import { describirEstilo, llevaTexto, normalizarEstilo, ordenarGrilla, type Pieza } from "../../shared/cos/grilla.ts"
import { TRAITS_VERSION, normalizarRasgos, ritmoDeCortes } from "../../shared/cos/gustos.ts"
import { gustosHandlers } from "./gustos.ts"

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
  // Las placas del sistema no se analizan ni se archivan: son un fondo de color.
  if (a.source === "sistema") return log("placa del sistema lista", { asset: a.id })
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
  // Todo lo que no llega de la cocina en el momento (carpetas, Instagram, base de fotos en Drive).
  const archivo = ["archivo", "instagram", "drive"].includes(extra?.source ?? "")

  // Fotogramas para la IA y, en video, el ritmo de edición (cortes por segundo) para el motor de gustos.
  const { frames, ritmo, dur } = await withTmp(async (dir) => {
    const file = await writeTmp(dir, "original", original)
    const info = await probe(file, a.mime)
    const frames = await framesForAi(file, info, dir)
    if (info.mediaType !== "video" || !info.durationMs) return { frames, ritmo: null, dur: null }
    const dur = info.durationMs / 1000
    const cuts = await sceneCuts(file).catch((e) => (log("no se pudo medir el ritmo del video", { asset: a.id, error: String(e) }), null))
    return { frames, ritmo: cuts ? ritmoDeCortes(cuts, dur) : null, dur }
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
    archivo,
  })

  // Caras de clientes o menores: se bloquea hasta que una persona lo revise (la base
  // impide programar cualquier post que lo use).
  const blocked = c.risk_flags.some((f) => BLOCKING_RISK_FLAGS.includes(f))
  await must(
    db
      .from("cos_assets")
      .update({
        ai_json: c,
        traits: normalizarRasgos({ ...c.rasgos, ritmo, duracion_s: dur }),
        traits_version: TRAITS_VERSION,
        traits_error: null,
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
    clima: await climaParaHoy(db, a.brand_id).catch((e) => (log("sin clima", { error: String(e) }), null)),
  })
  const caption = `${c.hook.trim()}\n${c.caption.trim()}`
  const hashtags = c.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")

  // Un borrador por formato: se aprueban (o rechazan) por separado. La historia va sin texto.
  const brandSlug = (await brandContext(db, a.brand_id)).slug
  const limpiar = (x: string) => x.replace(/[#\p{Extended_Pictographic}]/gu, "").trim().slice(0, 60)
  const overlay = limpiar(c.overlay)
  // La frase del clima va solo en la historia (regla de Javier); el resto lleva la frase normal.
  const overlayClima = limpiar(c.overlay_clima ?? "")
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
          overlay_text: f.post_type === "story" && overlayClima ? overlayClima : overlay,
          // Si la plantilla de la marca no lleva texto (firma), la historia del clima usa etiqueta.
          template: f.post_type === "story" && overlayClima && ["firma", "none"].includes(template) ? "etiqueta" : template,
          music_key: withMusic && !(f.platform === "instagram" && f.post_type === "feed") ? pick : null,
          uses_weather: c.usa_clima || (f.post_type === "story" && !!overlayClima),
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
    // Se publica la pieza que se aprobó, tal cual (aunque después cambie la tipografía o el logo).
    const key = rp ? (rp.render_key && (await exists(db, rp.render_key)) ? rp.render_key : await ensureRender(db, rp)) : null
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
      await db.from("cos_posts").update({ first_render_at: new Date().toISOString() }).eq("id", postId).is("first_render_at", null)
      return
    }
    const r = await renderReviewed(db, p, s.ai_model)
    const now = await loadRenderPost(db, postId)
    const changed =
      now.template !== p.template || now.overlay_text !== p.overlay_text || now.music_key !== p.music_key || now.overlay_position !== p.overlay_position
    if (changed) continue
    await setPost(db, postId, { render_key: r.key, overlay_layout: r.layout, render_qa: r.qa })
    // La primera vez que queda lista, el borrador pasa a verse en Aprobaciones (nunca se borra).
    await db.from("cos_posts").update({ first_render_at: new Date().toISOString() }).eq("id", postId).is("first_render_at", null)
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
const syncContextJob: Handler = async (_job, { db, queue, log }) => {
  const r = await syncContext(db)
  log("contexto sincronizado", r)
  // Con los feriados al día, se arman (si falta) las historias de los próximos días.
  await queue.enqueue("holiday:stories", {}, { dedupeKey: `feriados:${arDay(new Date())}` })
}

// ── holiday:stories ─────────────────────────────────────────────────────────
/** Color de fondo de la placa de cada marca (cuando no hay foto buena). */
const FONDO_PLACA: Record<string, string> = { fasutofudo: "#1C1917", bijutsukan: "#0A0A0A", sensaciones: "#111111" }

/** Placa de fondo de la marca, como archivo del sistema. null si todavía se está preparando. */
async function placaDeMarca(db: SupabaseClient, queue: Queue, brand: { id: string; slug: string }): Promise<string | null> {
  const ext = `placa:${brand.slug}`
  const { data: ya } = await db.from("cos_assets").select("id, status, current_version_id").eq("source", "sistema").eq("source_external_id", ext).maybeSingle()
  if (ya) return ["READY", "IN_USE"].includes(ya.status) ? ya.current_version_id : null
  const data = await withTmp((dir) => placaFondo(FONDO_PLACA[brand.slug] ?? "#111111", dir))
  const key = `originals/${brand.slug}/sistema/placa-fondo.jpg`
  await supabaseStorage(db).upload(key, data, "image/jpeg")
  const { data: a, error } = await db
    .from("cos_assets")
    .insert({
      brand_id: brand.id,
      source: "sistema",
      source_external_id: ext,
      description: "Placa de fondo de la marca, para historias sin foto",
      submitted_by_label: "Social Hub",
      mime: "image/jpeg",
      size_bytes: data.byteLength,
      storage_driver: "supabase",
      storage_key: key,
      status: "NEW",
      consent: "ok",
    })
    .select("id")
    .single()
  if (error || !a) throw new Error(`placa: ${error?.message}`)
  await queue.enqueue("asset:process", { asset_id: a.id }, { dedupeKey: `process:${a.id}` })
  return null
}

/**
 * Historias de feriado (regla de Javier): para cada feriado de los próximos días, en las marcas
 * que abren ese día, dos historias seguidas (reservá con tiempo + "a último momento también te
 * esperamos"); el 25/12 y el 1/1, solo el saludo. Quedan en Aprobaciones YA PROGRAMADAS para ese
 * día. Lo que no se aprobó a tiempo se vence solo.
 */
const holidayStories: Handler = async (_job, { db, queue, log }) => {
  const hoy = arDay(new Date())
  const hasta = arDay(new Date(Date.now() + DIAS_ANTICIPACION * 86_400_000))

  // Lo que quedó sin aprobar y ya pasó, se vence (no se publica tarde).
  const { data: vencidas } = await db
    .from("cos_posts")
    .update({ status: "EXPIRED" })
    .like("campaign", "feriado:%")
    .eq("status", "PENDING_APPROVAL")
    .lt("scheduled_at", new Date().toISOString())
    .select("id")
  if (vencidas?.length) log("historias de feriado vencidas sin aprobar", { cantidad: vencidas.length })

  const { data: dias } = await db.from("cos_special_days").select("day, name").in("kind", ["feriado", "puente"]).gt("day", hoy).lte("day", hasta).order("day")
  if (!dias?.length) return
  const s = await settings(db)
  const { data: marcas } = await db.from("cos_brands").select("id, slug, rules_json").eq("active", true)
  for (const b of marcas ?? []) {
    const { data: ig } = await db.from("cos_social_accounts").select("id").eq("brand_id", b.id).eq("platform", "instagram").neq("status", "disabled").limit(1)
    if (!ig?.length) continue
    const abre = openDays((b.rules_json as { open_days?: string } | null)?.open_days)
    const brand = await brandContext(db, b.id)
    const music = await listMusic(db, b.slug)
    const usadas = new Set<string>()
    for (const d of dias) {
      for (const h of planFeriado(d.day, abre)) {
        const campaign = campaniaFeriado(d.day, h.orden)
        // Si ya pasó su momento (el feriado se cargó tarde), esa historia no se arma.
        if (new Date(horaBA(diasAntesDe(d.day, h.diasAntes), h.hora)).getTime() < Date.now() + 30 * 60_000) continue
        const { data: existe } = await db.from("cos_posts").select("id").eq("brand_id", b.id).eq("campaign", campaign).maybeSingle()
        if (existe) continue

        // Fondo: la mejor foto sin usar de la marca (sin caras bloqueadas); si no hay, la placa.
        const { data: fotos } = await db
          .from("cos_assets")
          .select("id, status, current_version_id")
          .eq("brand_id", b.id)
          .eq("media_type", "photo")
          .in("status", ["READY", "IN_USE"])
          .neq("consent", "blocked")
          .neq("source", "sistema")
          // Sin estado de revisión (cocina) o de archivo no descartado.
          .or("review_status.is.null,review_status.neq.discarded")
          .gte("quality_score", 70)
          .order("status", { ascending: false }) // READY (sin usar) antes que IN_USE
          .order("quality_score", { ascending: false })
          .limit(30)
        const foto = (fotos ?? []).find((f) => f.current_version_id && !usadas.has(f.id))
        const version = foto?.current_version_id ?? (await placaDeMarca(db, queue, b))
        if (!version) {
          log("historia de feriado: la placa de fondo se está preparando, sigue en la próxima vuelta", { brand: b.slug, day: d.day })
          continue
        }
        if (foto) usadas.add(foto.id)

        const { consigna, respaldo } = consignaFeriado(h.tipo, d.name, d.day)
        const frase = await writeHolidayPhrase({ db, model: s.ai_model, brand, consigna, feriado: d.name }).catch((e) => {
          log("historia de feriado: la IA no escribió, va el texto de respaldo", { error: String(e) })
          return respaldo
        })
        const plantilla = defaultTemplate(b.slug)
        const { data: post, error } = await db
          .from("cos_posts")
          .insert({
            brand_id: b.id,
            account_id: ig[0].id,
            platform: "instagram",
            post_type: "story",
            caption: "",
            hashtags: "",
            overlay_text: frase,
            // Tiene que verse el texto: si la marca usa solo firma, va etiqueta.
            template: ["firma", "none"].includes(plantilla) ? "etiqueta" : plantilla,
            music_key: music.length ? music[Math.floor(Math.random() * music.length)] : null,
            campaign,
            scheduled_at: horaBA(diasAntesDe(d.day, h.diasAntes), h.hora),
            status: "DRAFT",
          })
          .select("id")
          .single()
        if (error || !post) {
          if (error?.code === "23505") continue // otra vuelta la creó justo antes
          throw new Error(`historia de feriado: ${error?.message}`)
        }
        await must(db.from("cos_post_media").insert({ post_id: post.id, version_id: version, position: 0 }).select("post_id").single(), "archivo del post")
        await setPost(db, post.id, { status: "PENDING_APPROVAL" })
        await queue.enqueue("post:render", { post_id: post.id }, { dedupeKey: `render:${post.id}` })
        log("historia de feriado lista para aprobar", { brand: b.slug, day: d.day, tipo: h.tipo, frase })
      }
    }
  }
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

  let data = await drive.download(fileId)
  let mime = f.mimeType === "image/heif" ? "image/heic" : f.mimeType
  let extFinal = ext
  // El almacenamiento corta en ~50 MB: los videos más pesados se achican (fotos nunca llegan a eso).
  if (data.byteLength > UPLOAD_MAX_BYTES && mime.startsWith("video/")) {
    const chico = await withTmp((dir) => compactVideo(data, dir))
    if (!chico) return log("base de fotos: video demasiado pesado aun comprimido (se saltea)", { file: fileId, size: data.byteLength })
    log("base de fotos: video comprimido para que entre", { file: fileId, antes: data.byteLength, despues: chico.byteLength })
    data = chico
    mime = "video/mp4"
    extFinal = "mp4"
  }
  const { data: brand } = await db.from("cos_brands").select("slug").eq("id", brandId).single()
  const key = `originals/${brand?.slug ?? "sin-marca"}/drive/${fileId}.${extFinal}`
  await supabaseStorage(db).upload(key, data, mime)
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
      mime,
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

// ── ref:analyze (Marca → Motores) ───────────────────────────────────────────
/** Ficha de estilo de una referencia: cortes medidos con ffmpeg + lectura de la IA. */
const analyzeRef: Handler = async (job, { db, log }) => {
  const id = idFrom(job, "ref_id")
  const { data: r, error } = await db.from("cos_brand_assets").select("id, brand_id, kind, storage_key, mime, note").eq("id", id).single()
  if (error || !r) return log("referencia borrada antes de analizarse", { ref: id })
  if (r.kind !== "referencia") return
  try {
    const original = await supabaseStorage(db).download(r.storage_key)
    const esVideo = r.mime.startsWith("video/")
    const { frames, duracion, cortes } = await withTmp(async (dir) => {
      const f = await writeTmp(dir, esVideo ? "ref.mp4" : "ref", original)
      if (!esVideo) return { frames: [{ at: null, data: await toJpeg(f, dir) }], duracion: null, cortes: null }
      const info = await probe(f, r.mime)
      const dur = (info.durationMs ?? 0) / 1000
      const cuts = await sceneCuts(f)
      // 10 cuadros parejos a lo largo del video (la IA los ve en orden, con su segundo).
      const n = Math.min(10, Math.max(3, Math.ceil(dur)))
      const times = Array.from({ length: n }, (_, i) => (dur * (i + 0.5)) / n)
      const imgs = await framesAt(f, times, dir)
      return { frames: imgs.map((data, i) => ({ at: times[i], data })), duracion: dur, cortes: cuts }
    })
    const s = await settings(db)
    const ficha = await analyzeReference({ db, model: s.ai_model, brand: await brandContext(db, r.brand_id), frames, duracion, cortes, nota: r.note })
    const medidas = duracion != null ? { duracion_s: Math.round(duracion * 10) / 10, cortes: cortes!.length, toma_promedio_s: Math.round((duracion / (cortes!.length + 1)) * 10) / 10 } : null
    await db.from("cos_brand_assets").update({ status: "lista", analysis: { ...ficha, medidas }, error: null }).eq("id", id)
    log("referencia analizada", { ref: id, cortes: cortes?.length ?? null })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.from("cos_brand_assets").update({ status: "error", error: msg.slice(0, 300) }).eq("id", id)
    throw e
  }
}

// ── feed:analyze (F6) ───────────────────────────────────────────────────────
/**
 * La IA mira la grilla del perfil de Instagram tal como va a quedar (lo publicado + lo que está
 * por salir) con las métricas de la cuenta, y deja observaciones, un estilo por columna sugerido
 * y cambios de orden propuestos. No toca ningún post.
 */
const analyzeFeed: Handler = async (job, { db, log }) => {
  const brandId = idFrom(job, "brand_id")
  const conPendientes = job.payload.con_pendientes === true
  const guardar = (x: Record<string, unknown>) =>
    db.from("cos_brands").update({ feed_analisis: x, ...(x.status === "lista" ? { feed_analisis_at: new Date().toISOString() } : {}) }).eq("id", brandId)
  try {
    const { data: acc } = await db.from("cos_social_accounts").select("id").eq("brand_id", brandId).eq("platform", "instagram").neq("status", "disabled").limit(1).maybeSingle()
    if (!acc) throw new PermanentError("la marca no tiene Instagram conectado")
    const desde90 = new Date(Date.now() - 90 * 86_400_000).toISOString()
    const [{ data: media }, { data: posts }, { data: b }, { data: hist }] = await Promise.all([
      db.from("cos_media").select("id, format, posted_at, thumb_key, metrics").eq("account_id", acc.id).neq("format", "story").order("posted_at", { ascending: false }).limit(30),
      db
        .from("cos_posts")
        .select("id, status, post_type, scheduled_at, template, overlay_text, render_key, cos_post_media(position, cos_asset_versions(cos_assets!cos_asset_versions_asset_id_fkey(thumb_key)))")
        .eq("account_id", acc.id)
        .in("post_type", ["feed", "reel", "carousel"])
        .in("status", conPendientes ? ["APPROVED", "SCHEDULED", "PENDING_APPROVAL"] : ["APPROVED", "SCHEDULED"])
        .is("deleted_at", null),
      db.from("cos_brands").select("grid_style").eq("id", brandId).single(),
      db.from("cos_media").select("format, metrics").eq("account_id", acc.id).neq("format", "story").gte("posted_at", desde90),
    ])
    type P = { id: string; status: string; post_type: "feed" | "reel" | "carousel"; scheduled_at: string | null; template: string; overlay_text: string | null; render_key: string | null; cos_post_media: { position: number; cos_asset_versions: { cos_assets: { thumb_key: string | null } | null } | null }[] }
    const claves = new Map<string, string | null>()
    const alcance = new Map<string, number | null>()
    const piezas: Pieza[] = [
      ...((posts ?? []) as unknown as P[]).map((p) => {
        const thumb = [...p.cos_post_media].sort((x, y) => x.position - y.position)[0]?.cos_asset_versions?.cos_assets?.thumb_key ?? null
        claves.set(p.id, p.render_key?.endsWith(".jpg") ? p.render_key : thumb)
        return {
          id: p.id,
          estado: p.status === "PENDING_APPROVAL" ? ("pendiente" as const) : ("programado" as const),
          at: p.status === "PENDING_APPROVAL" ? null : (p.scheduled_at ?? new Date().toISOString()),
          formato: p.post_type,
          conTexto: llevaTexto(p.template, p.overlay_text),
        }
      }),
      ...(media ?? []).map((m) => {
        claves.set(m.id, m.thumb_key)
        const mt = (m.metrics ?? {}) as Record<string, number>
        alcance.set(m.id, mt.reach || mt.views || null)
        return { id: m.id, estado: "publicado" as const, at: m.posted_at, formato: m.format as Pieza["formato"], conTexto: null }
      }),
    ]
    const grilla = ordenarGrilla(piezas).slice(0, 18)
    const imgs = await Promise.all(
      grilla.map((g) => {
        const k = claves.get(g.id)
        return k ? supabaseStorage(db).download(k).catch(() => null) : Promise.resolve(null)
      }),
    )
    const imagen = await withTmp((dir) => grillaImagen(imgs, dir))
    const fmt = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "numeric" })
    const posiciones = grilla.map((g, i) =>
      g.estado === "publicado"
        ? `${i + 1}. publicada el ${fmt(g.at!)} · ${g.formato}${alcance.get(g.id) ? ` · alcance ${alcance.get(g.id)!.toLocaleString("es-AR")}` : ""}`
        : `${i + 1}. POR SALIR (${g.estado === "pendiente" ? "pendiente de aprobar" : `programada ${fmt(g.at!)}`}) · ${g.formato} · ${g.conTexto ? "con texto" : "sin texto"}`,
    )
    // Rendimiento por formato: mediana de alcance (o vistas) de los últimos 90 días.
    const porFormato = new Map<string, number[]>()
    for (const h of hist ?? []) {
      const mt = (h.metrics ?? {}) as Record<string, number>
      const v = mt.reach || mt.views
      if (v) porFormato.set(h.format, [...(porFormato.get(h.format) ?? []), v])
    }
    const mediana = (xs: number[]) => [...xs].sort((a, c) => a - c)[Math.floor(xs.length / 2)]
    const rendimiento =
      [...porFormato.entries()].map(([f, xs]) => `${f}: mediana ${mediana(xs).toLocaleString("es-AR")} (${xs.length} publicaciones)`).join(" · ") || "sin datos suficientes"

    const s = await settings(db)
    const r = await analyzeGrid({
      db,
      model: s.ai_model,
      brand: await brandContext(db, brandId),
      grilla: imagen,
      posiciones,
      rendimiento,
      estiloActual: describirEstilo(normalizarEstilo(b?.grid_style)),
    })
    // Lo que la IA ve en lo ya publicado queda guardado (sirve para marcar el estilo en la grilla).
    for (const [i, g] of grilla.entries()) {
      if (g.estado === "publicado" && typeof r.con_texto[i] === "boolean") await db.from("cos_media").update({ con_texto: r.con_texto[i] }).eq("id", g.id)
    }
    await guardar({
      status: "lista",
      resumen: r.resumen,
      observaciones: r.observaciones,
      estilo_sugerido: r.estilo_sugerido ? { columnas: [r.estilo_sugerido.izquierda, r.estilo_sugerido.centro, r.estilo_sugerido.derecha], por_que: r.estilo_sugerido.por_que } : null,
      cambios_de_orden: r.cambios_de_orden,
      otras_ideas: r.otras_ideas,
    })
    log("grilla analizada", { brand: brandId, posiciones: grilla.length })
  } catch (e) {
    await guardar({ status: "error", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) })
    throw e
  }
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
  "ref:analyze": analyzeRef,
  "holiday:stories": holidayStories,
  "feed:analyze": analyzeFeed,
  "archive:import-drive-file": importDriveFile,
  "ingest:turnos": ingestTurnosJob,
  "accounts:check": checkAccounts,
  ...gustosHandlers,
}

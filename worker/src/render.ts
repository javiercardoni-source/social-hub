/**
 * Imagen/video FINAL de un post: encuadre del formato (4:5, 9:16…) + plantilla de marca.
 * Es lo que se ve en Aprobaciones y lo que se publica: la misma pieza, byte a byte.
 *
 * La clave en cos-media sale del contenido (archivo, formato, plantilla, texto), así que
 * rehacerla con lo mismo da el mismo archivo y cualquier cambio da uno nuevo.
 */
import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { PermanentError } from "./queue.ts"
import { storageFor, supabaseStorage } from "./storage.ts"
import { compositePhoto, finishVideo, fitForInstagramFeed, fitForStory, photoToReel, probe, toJpeg, withTmp, writeTmp } from "./media.ts"
import { KITS, layoutCandidates, renderOverlay, type CustomKit, type Layout, type Template } from "./overlay.ts"
import { reviewPiece, type PieceReview } from "./ai.ts"

// Subir este número vuelve a generar todas las piezas (si cambia el diseño de las plantillas).
const RENDER_VERSION = "6"
const PHOTO_REEL_SECONDS = 8

export type RenderPost = {
  id: string
  platform: string
  post_type: "feed" | "carousel" | "reel" | "story"
  overlay_text: string
  template: Template
  music_key: string | null
  overlay_position: "auto" | Layout
  /** Posición resuelta (la eligió la revisión visual o Javier). Sin resolver = abajo. */
  overlay_layout: Layout | null
  brand_slug: string
  /** Tipografías y logo que cargó Javier en Marca → Motores (si hay). */
  kit?: CustomKit
  version: { id: string; storage_driver: string; storage_key: string | null; drive_file_id: string | null; mime: string | null }
}

/**
 * El resultado es un video si el original lo es, si es un reel, o si es una foto con música
 * (historia o Facebook): la API de Meta no deja poner música a un post de foto, así que
 * esas salen como video de 8 s con zoom.
 */
export function rendersVideo(p: RenderPost): boolean {
  const isVideo = !!p.version.mime?.startsWith("video/")
  return isVideo || p.post_type === "reel" || (!!p.music_key && (p.post_type === "story" || p.platform === "facebook"))
}

export function renderKey(p: RenderPost): string | null {
  const isVideo = !!p.version.mime?.startsWith("video/")
  // Un video sin plantilla ni música se publica tal cual: no hay nada que armar.
  if (isVideo && p.template === "none" && !p.music_key) return null
  const h = createHash("sha256")
    // El diseño de la plantilla de la marca (KITS) entra en la clave: si cambia, se rearma solo.
    .update([RENDER_VERSION, p.version.id, p.platform, p.post_type, p.template, p.overlay_text, p.music_key ?? "", p.brand_slug, p.overlay_layout ?? "bottom", p.kit?.version ?? "", JSON.stringify(KITS[p.brand_slug] ?? null)].join("\x1f"))
    .digest("hex")
    .slice(0, 16)
  return `renders/${p.id}/${h}.${rendersVideo(p) ? "mp4" : "jpg"}`
}

export async function exists(db: SupabaseClient, key: string) {
  const dir = key.slice(0, key.lastIndexOf("/"))
  const name = key.slice(key.lastIndexOf("/") + 1)
  const { data } = await db.storage.from("cos-media").list(dir, { search: name, limit: 1 })
  return !!data?.some((f) => f.name === name)
}

/** Arma la pieza final si no existe y devuelve su clave (o null = publicar el original). */
export async function ensureRender(db: SupabaseClient, p: RenderPost): Promise<string | null> {
  const key = renderKey(p)
  if (!key || (await exists(db, key))) return key

  const v = p.version
  const original =
    v.storage_driver === "supabase" && v.storage_key
      ? await supabaseStorage(db).download(v.storage_key)
      : await storageFor("drive", db).download(v.drive_file_id ?? v.storage_key ?? "")
  if (!original.byteLength) throw new PermanentError("el archivo original está vacío")

  const isVideo = !!v.mime?.startsWith("video/")
  const story = p.post_type === "story"
  const reel = p.post_type === "reel"
  const igFeed = p.platform === "instagram" && (p.post_type === "feed" || p.post_type === "carousel")
  const music = p.music_key ? await supabaseStorage(db).download(p.music_key) : null

  const data = await withTmp(async (dir) => {
    const f = await writeTmp(dir, isVideo ? "in.mp4" : "in", original)
    if (isVideo) {
      const info = await probe(f, v.mime)
      const layer = await renderOverlay({ brand: p.brand_slug, template: p.template, text: p.overlay_text, width: info.width, height: info.height, story: story || reel, layout: p.overlay_layout ?? "bottom", custom: p.kit })
      return finishVideo({ video: original, layer, music, dir })
    }
    if (rendersVideo(p)) {
      const base = await fitForStory(f, dir)
      const layer = await renderOverlay({ brand: p.brand_slug, template: p.template, text: p.overlay_text, width: 1080, height: 1920, story: true, layout: p.overlay_layout ?? "bottom", custom: p.kit })
      return photoToReel({ photo9x16: base, layer, music, seconds: PHOTO_REEL_SECONDS, dir })
    }
    const base = story ? await fitForStory(f, dir) : igFeed ? await fitForInstagramFeed(f, dir) : await toJpeg(f, dir)
    const info = await probe(await writeTmp(dir, "fit.jpg", base), "image/jpeg")
    const layer = await renderOverlay({ brand: p.brand_slug, template: p.template, text: p.overlay_text, width: info.width, height: info.height, story, layout: p.overlay_layout ?? "bottom", custom: p.kit })
    return layer ? compositePhoto(base, layer, dir) : base
  })

  await supabaseStorage(db).upload(key, data, rendersVideo(p) ? "video/mp4" : "image/jpeg")
  return key
}

/** Un cuadro de la pieza para revisarla: la imagen, o el cuadro del medio del video. */
async function frameOf(db: SupabaseClient, key: string): Promise<Buffer> {
  const data = await supabaseStorage(db).download(key)
  if (!key.endsWith(".mp4")) return data
  return withTmp(async (dir) => {
    const f = await writeTmp(dir, "piece.mp4", data)
    const info = await probe(f, "video/mp4")
    const at = ((info.durationMs ?? 4000) / 1000) * 0.6
    const { execFile } = await import("node:child_process")
    const { promisify } = await import("node:util")
    const out = `${dir}/frame.jpg`
    await promisify(execFile)("ffmpeg", ["-y", "-ss", at.toFixed(2), "-i", f, "-frames:v", "1", "-q:v", "3", out], { timeout: 60_000 })
    const { readFile } = await import("node:fs/promises")
    return readFile(out)
  })
}

export type Resolved = { key: string | null; layout: Layout | null; qa: (PieceReview & { tried: Layout[] }) | { skipped: string } }

/**
 * Arma la pieza probando posiciones y haciéndola revisar por la IA: se queda con la primera
 * que no tapa nada. Si ninguna pasa, devuelve la mejor puntuada con la advertencia a la vista.
 */
export async function renderReviewed(db: SupabaseClient, p: RenderPost, model: string): Promise<Resolved> {
  if (p.template === "none") {
    return { key: await ensureRender(db, { ...p, overlay_layout: null }), layout: null, qa: { skipped: "sin plantilla" } }
  }
  const tried: Layout[] = []
  let best: { key: string | null; layout: Layout; review: PieceReview } | null = null
  for (const layout of layoutCandidates(p.template, p.overlay_position)) {
    const key = await ensureRender(db, { ...p, overlay_layout: layout })
    if (!key) return { key, layout, qa: { skipped: "video sin cambios" } }
    const review = await reviewPiece({ db, model, image: await frameOf(db, key), overlayText: p.overlay_text, template: p.template })
    tried.push(layout)
    if (!best || review.score > best.review.score || (review.ok && !best.review.ok)) best = { key, layout, review }
    if (review.ok) break
  }
  return { key: best!.key, layout: best!.layout, qa: { ...best!.review, tried } }
}

/** Carga lo que hace falta para armar la pieza de un post. */
export async function loadRenderPost(db: SupabaseClient, postId: string): Promise<RenderPost & { render_key: string | null; render_qa: unknown; status: string }> {
  const { data, error } = await db
    .from("cos_posts")
    .select(
      `id, status, platform, post_type, overlay_text, template, music_key, overlay_position, overlay_layout, render_key, render_qa, brand_id, cos_brands(slug),
       cos_post_media(position, cos_asset_versions(id, storage_driver, storage_key, drive_file_id, mime))`,
    )
    .eq("id", postId)
    .single()
  if (error || !data) throw new Error(`post ${postId}: ${error?.message ?? "no existe"}`)
  const row = data as unknown as {
    id: string
    status: string
    platform: string
    post_type: RenderPost["post_type"]
    overlay_text: string
    template: Template
    music_key: string | null
    overlay_position: "auto" | Layout
    overlay_layout: Layout | null
    render_key: string | null
    render_qa: unknown
    brand_id: string
    cos_brands: { slug: string } | null
    cos_post_media: { position: number; cos_asset_versions: RenderPost["version"] | null }[]
  }
  const version = [...row.cos_post_media].sort((a, b) => a.position - b.position)[0]?.cos_asset_versions
  if (!version) throw new PermanentError("el post no tiene archivos")
  return { ...row, brand_slug: row.cos_brands?.slug ?? "", version, kit: await loadKit(db, row.brand_id) }
}

// ── Kit propio de la marca (Marca → Motores) ─────────────────────────────────
const kitCache = new Map<string, { at: number; kit: CustomKit | undefined }>()
const fileCache = new Map<string, Buffer>()

/** Ancho/alto de un PNG (cabecera IHDR). */
function pngAspect(png: Buffer): number {
  if (png.length < 24 || png.toString("ascii", 1, 4) !== "PNG") throw new PermanentError("el logo no es un PNG")
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  if (!w || !h) throw new PermanentError("el logo tiene medidas inválidas")
  return w / h
}

/** Tipografías y logo que cargó Javier. undefined = se usa el kit de siempre. Cache de 1 minuto. */
export async function loadKit(db: SupabaseClient, brandId: string): Promise<CustomKit | undefined> {
  const hit = kitCache.get(brandId)
  if (hit && Date.now() - hit.at < 60_000) return hit.kit
  const { data } = await db
    .from("cos_brand_assets")
    .select("id, kind, storage_key")
    .eq("brand_id", brandId)
    .in("kind", ["fuente_titulo", "fuente_texto", "logo"])
    .order("kind")
  let kit: CustomKit | undefined
  if (data?.length) {
    kit = { version: data.map((a) => a.id).join(".") }
    for (const a of data) {
      if (!fileCache.has(a.storage_key)) fileCache.set(a.storage_key, await supabaseStorage(db).download(a.storage_key))
      const buf = fileCache.get(a.storage_key)!
      // Nombre de familia propio: no choca con las tipografías del kit.
      if (a.kind === "fuente_titulo") kit.title = { name: `Titulo-${a.id.slice(0, 8)}`, data: buf }
      if (a.kind === "fuente_texto") kit.text = { name: `Texto-${a.id.slice(0, 8)}`, data: buf }
      if (a.kind === "logo") kit.logo = { data: buf, aspect: pngAspect(buf) }
    }
  }
  kitCache.set(brandId, { at: Date.now(), kit })
  return kit
}

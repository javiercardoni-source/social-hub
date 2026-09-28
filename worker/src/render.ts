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
import { renderOverlay, type Template } from "./overlay.ts"

// Subir este número vuelve a generar todas las piezas (si cambia el diseño de las plantillas).
const RENDER_VERSION = "5"
const PHOTO_REEL_SECONDS = 8

export type RenderPost = {
  id: string
  platform: string
  post_type: "feed" | "carousel" | "reel" | "story"
  overlay_text: string
  template: Template
  music_key: string | null
  brand_slug: string
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
    .update([RENDER_VERSION, p.version.id, p.platform, p.post_type, p.template, p.overlay_text, p.music_key ?? "", p.brand_slug].join("\x1f"))
    .digest("hex")
    .slice(0, 16)
  return `renders/${p.id}/${h}.${rendersVideo(p) ? "mp4" : "jpg"}`
}

async function exists(db: SupabaseClient, key: string) {
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
      const layer = await renderOverlay({ brand: p.brand_slug, template: p.template, text: p.overlay_text, width: info.width, height: info.height, story: story || reel })
      return finishVideo({ video: original, layer, music, dir })
    }
    if (rendersVideo(p)) {
      const base = await fitForStory(f, dir)
      const layer = await renderOverlay({ brand: p.brand_slug, template: p.template, text: p.overlay_text, width: 1080, height: 1920, story: true })
      return photoToReel({ photo9x16: base, layer, music, seconds: PHOTO_REEL_SECONDS, dir })
    }
    const base = story ? await fitForStory(f, dir) : igFeed ? await fitForInstagramFeed(f, dir) : await toJpeg(f, dir)
    const info = await probe(await writeTmp(dir, "fit.jpg", base), "image/jpeg")
    const layer = await renderOverlay({ brand: p.brand_slug, template: p.template, text: p.overlay_text, width: info.width, height: info.height, story })
    return layer ? compositePhoto(base, layer, dir) : base
  })

  await supabaseStorage(db).upload(key, data, rendersVideo(p) ? "video/mp4" : "image/jpeg")
  return key
}

/** Carga lo que hace falta para armar la pieza de un post. */
export async function loadRenderPost(db: SupabaseClient, postId: string): Promise<RenderPost & { render_key: string | null; status: string }> {
  const { data, error } = await db
    .from("cos_posts")
    .select(
      `id, status, platform, post_type, overlay_text, template, music_key, render_key, cos_brands(slug),
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
    render_key: string | null
    cos_brands: { slug: string } | null
    cos_post_media: { position: number; cos_asset_versions: RenderPost["version"] | null }[]
  }
  const version = [...row.cos_post_media].sort((a, b) => a.position - b.position)[0]?.cos_asset_versions
  if (!version) throw new PermanentError("el post no tiene archivos")
  return { ...row, brand_slug: row.cos_brands?.slug ?? "", version }
}

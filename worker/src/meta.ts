/**
 * Publicación en Instagram y Facebook por la Graph API (PLAN §9.4).
 *
 * Los tokens son de página, no vencen, y viven en variables de entorno (la base solo
 * guarda el NOMBRE de la variable: cos_social_accounts.token_ref). Los arma el script
 * scripts/meta-conectar.py.
 *
 * Instagram es en dos pasos (contenedor → media_publish). El id del contenedor se guarda
 * apenas existe: si el worker se corta, el reintento reusa ese contenedor en vez de
 * crear otro (PLAN §6).
 */
import { PermanentError } from "./queue.ts"
import { sameCaption } from "../../shared/cos/caption.ts"

const VERSION = process.env.META_GRAPH_VERSION ?? "v26.0"
const GRAPH = `https://graph.facebook.com/${VERSION}`

export type MediaItem = { kind: "photo" | "video"; url: string }
export type PostType = "feed" | "carousel" | "reel" | "story"

/** Error de Meta con su código, para decidir si reintentar. */
export class MetaError extends Error {
  code: number
  subcode: number | null
  constructor(message: string, code: number, subcode: number | null) {
    super(message)
    this.name = "MetaError"
    this.code = code
    this.subcode = subcode
  }
}

// Códigos que se arreglan solos esperando (límite de llamadas, caída temporal).
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 9007])

export function isTokenError(e: unknown): boolean {
  const m = e instanceof MetaError ? e : (e as { meta?: unknown } | null)?.meta
  return m instanceof MetaError && (m.code === 190 || m.code === 102)
}

export function tokenFor(tokenRef: string | null): string {
  const token = tokenRef ? process.env[tokenRef] : undefined
  if (!token) throw new PermanentError(`falta el token de la cuenta (variable ${tokenRef ?? "sin nombre"} en el servidor)`)
  return token
}

export async function graph<T>(method: "GET" | "POST" | "DELETE", path: string, token: string, params: Record<string, string | boolean | undefined> = {}): Promise<T> {
  const clean = Object.fromEntries(
    Object.entries({ ...params, access_token: token }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]),
  )
  const qs = new URLSearchParams(clean)
  const res = await fetch(method === "POST" ? `${GRAPH}/${path}` : `${GRAPH}/${path}?${qs}`, {
    method,
    body: method === "POST" ? qs : undefined,
  })
  const body = (await res.json().catch(() => ({}))) as T & {
    error?: { message: string; code: number; error_subcode?: number; error_user_msg?: string; is_transient?: boolean }
  }
  if (!res.ok || body.error) {
    const e = body.error
    const message = `Meta: ${e?.error_user_msg ?? e?.message ?? `HTTP ${res.status}`}`
    const err = new MetaError(message, e?.code ?? res.status, e?.error_subcode ?? null)
    const transient = e?.is_transient || TRANSIENT_CODES.has(err.code) || res.status >= 500
    // Lo que no es transitorio (permiso, token, archivo inválido) no se arregla reintentando.
    if (!transient) throw Object.assign(new PermanentError(message), { meta: err })
    throw err
  }
  return body
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── Instagram ───────────────────────────────────────────────────────────────

type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED"

async function containerStatus(id: string, token: string) {
  return graph<{ status_code: ContainerStatus; status?: string }>("GET", id, token, { fields: "status_code,status" })
}

/** Espera a que Meta termine de procesar el archivo (los videos tardan). */
// Menos de 10 min: pasado ese tiempo el reloj da el post por colgado y lo reconcilia.
// Si Meta tarda más, se reintenta reusando el mismo contenedor (no se duplica).
async function waitFinished(id: string, token: string, signal: AbortSignal, maxMs = 8 * 60_000): Promise<void> {
  const until = Date.now() + maxMs
  while (Date.now() < until) {
    const s = await containerStatus(id, token)
    if (s.status_code === "FINISHED" || s.status_code === "PUBLISHED") return
    if (s.status_code === "ERROR") throw new PermanentError(`Instagram no pudo procesar el archivo: ${s.status ?? "sin detalle"}`)
    if (s.status_code === "EXPIRED") throw new Error("el contenedor de Instagram venció (se crea otro)")
    if (signal.aborted) throw new Error("el worker se está apagando: se retoma después")
    await sleep(5_000)
  }
  throw new Error("Instagram tardó demasiado en procesar el archivo (se reintenta)")
}

function mediaParams(item: MediaItem, type: PostType): Record<string, string> {
  if (type === "story") return item.kind === "photo" ? { media_type: "STORIES", image_url: item.url } : { media_type: "STORIES", video_url: item.url }
  // Instagram ya no acepta videos "de feed": todo video va como reel y se muestra en el feed.
  if (item.kind === "video") return { media_type: "REELS", video_url: item.url, share_to_feed: "true" }
  return { image_url: item.url }
}

export async function publishInstagram(opts: {
  igUserId: string
  token: string
  type: PostType
  caption: string
  media: MediaItem[]
  existingContainerId: string | null
  saveContainer: (id: string) => Promise<void>
  signal: AbortSignal
  /** Reels: milisegundo del video que se usa como tapa en el perfil (thumb_offset). */
  thumbOffsetMs?: number
}): Promise<{ remoteId: string; permalink: string | null }> {
  const { igUserId, token, type, caption, media, signal } = opts
  if (media.length === 0) throw new PermanentError("el post no tiene archivos")

  let containerId = opts.existingContainerId
  if (containerId) {
    // Reintento: si el contenedor anterior sigue sano se reusa (no se duplica el post).
    const s = await containerStatus(containerId, token).catch(() => null)
    if (s?.status_code === "PUBLISHED") {
      // Ya salió en un intento anterior que se cortó antes de guardar el id: se adopta.
      const found = await findInstagramPost(igUserId, token, caption, new Date(), 24 * 3600_000)
      if (found) return { remoteId: found.id, permalink: found.permalink ?? null }
      throw new PermanentError("Instagram dice que ya se publicó pero no encuentro el post: revisarlo a mano")
    }
    if (!s || s.status_code === "ERROR" || s.status_code === "EXPIRED") containerId = null
  }

  if (!containerId) {
    if (type === "carousel") {
      if (media.length < 2) throw new PermanentError("un carrusel necesita al menos 2 archivos")
      const children: string[] = []
      for (const item of media.slice(0, 10)) {
        const params = item.kind === "photo" ? { image_url: item.url } : { media_type: "VIDEO", video_url: item.url }
        const child = await graph<{ id: string }>("POST", `${igUserId}/media`, token, { ...params, is_carousel_item: true })
        await waitFinished(child.id, token, signal)
        children.push(child.id)
      }
      containerId = (await graph<{ id: string }>("POST", `${igUserId}/media`, token, {
        media_type: "CAROUSEL",
        children: children.join(","),
        caption,
      })).id
    } else {
      const params = mediaParams(media[0], type)
      const tapa = params.media_type === "REELS" && opts.thumbOffsetMs != null ? { thumb_offset: String(Math.round(opts.thumbOffsetMs)) } : {}
      containerId = (await graph<{ id: string }>("POST", `${igUserId}/media`, token, {
        ...params,
        ...tapa,
        ...(type === "story" ? {} : { caption }),
      })).id
    }
    await opts.saveContainer(containerId)
  }

  await waitFinished(containerId, token, signal)
  const published = await graph<{ id: string }>("POST", `${igUserId}/media_publish`, token, { creation_id: containerId })
  const info = await graph<{ permalink?: string }>("GET", published.id, token, { fields: "permalink" }).catch(() => ({ permalink: undefined }))
  return { remoteId: published.id, permalink: info.permalink ?? null }
}

/** Busca un post ya publicado por texto exacto y hora (reconciliación, PLAN §6.3). */
export async function findInstagramPost(igUserId: string, token: string, caption: string, around: Date, windowMs = 15 * 60_000) {
  const r = await graph<{ data: { id: string; caption?: string; timestamp: string; permalink?: string }[] }>(
    "GET",
    `${igUserId}/media`,
    token,
    { fields: "id,caption,timestamp,permalink", limit: "25" },
  )
  return r.data.find((m) => sameCaption(m.caption, caption) && Math.abs(new Date(m.timestamp).getTime() - around.getTime()) < windowMs) ?? null
}

// ── Facebook ────────────────────────────────────────────────────────────────

export async function publishFacebook(opts: {
  pageId: string
  token: string
  type: PostType
  caption: string
  media: MediaItem[]
}): Promise<{ remoteId: string; permalink: string | null }> {
  const { pageId, token, type, caption, media } = opts
  if (media.length === 0) throw new PermanentError("el post no tiene archivos")
  if (type === "story") throw new PermanentError("las historias de Facebook todavía no están soportadas")

  let remoteId: string
  if (media.length === 1 && media[0].kind === "video") {
    remoteId = (await graph<{ id: string }>("POST", `${pageId}/videos`, token, { file_url: media[0].url, description: caption })).id
    const info = await graph<{ permalink_url?: string }>("GET", remoteId, token, { fields: "permalink_url" }).catch(() => ({ permalink_url: undefined }))
    const url = info.permalink_url ? (info.permalink_url.startsWith("http") ? info.permalink_url : `https://www.facebook.com${info.permalink_url}`) : null
    return { remoteId, permalink: url }
  }
  if (media.some((m) => m.kind === "video")) throw new PermanentError("Facebook: mezclar fotos y videos en un post todavía no está soportado")

  if (media.length === 1) {
    const r = await graph<{ id: string; post_id?: string }>("POST", `${pageId}/photos`, token, { url: media[0].url, message: caption })
    remoteId = r.post_id ?? r.id
  } else {
    const ids: string[] = []
    for (const m of media.slice(0, 10)) {
      ids.push((await graph<{ id: string }>("POST", `${pageId}/photos`, token, { url: m.url, published: false })).id)
    }
    remoteId = (await graph<{ id: string }>("POST", `${pageId}/feed`, token, {
      message: caption,
      attached_media: JSON.stringify(ids.map((id) => ({ media_fbid: id }))),
    })).id
  }
  const info = await graph<{ permalink_url?: string }>("GET", remoteId, token, { fields: "permalink_url" }).catch(() => ({ permalink_url: undefined }))
  return { remoteId, permalink: info.permalink_url ?? null }
}

export async function findFacebookPost(pageId: string, token: string, caption: string, around: Date) {
  const r = await graph<{ data: { id: string; message?: string; created_time: string; permalink_url?: string }[] }>(
    "GET",
    `${pageId}/published_posts`,
    token,
    { fields: "id,message,created_time,permalink_url", limit: "25" },
  )
  return r.data.find((p) => sameCaption(p.message, caption) && Math.abs(new Date(p.created_time).getTime() - around.getTime()) < 15 * 60_000) ?? null
}

// ── Chequeo de cuentas ──────────────────────────────────────────────────────

export async function checkAccount(platform: string, externalId: string, token: string): Promise<string> {
  if (platform === "instagram") {
    const r = await graph<{ username: string }>("GET", externalId, token, { fields: "username" })
    await graph("GET", `${externalId}/content_publishing_limit`, token, { fields: "quota_usage" })
    return `@${r.username}`
  }
  if (platform === "facebook") {
    return (await graph<{ name: string }>("GET", externalId, token, { fields: "name" })).name
  }
  throw new PermanentError(`${platform} todavía no está soportado`)
}

// ── Borrar lo publicado ─────────────────────────────────────────────────────

/**
 * Borra un post de la red. Facebook lo permite con el token de página. En Instagram se
 * intenta igual: si Meta no lo permite, el error vuelve legible para que se borre a mano.
 * Si ya no existe (lo borraron a mano, o era una historia que venció), se toma como hecho.
 */
export async function deleteRemote(remoteId: string, token: string): Promise<"deleted" | "already_gone"> {
  try {
    const r = await graph<{ success?: boolean }>("DELETE", remoteId, token)
    if (r.success === false) throw new PermanentError("Meta respondió que no se pudo borrar")
    return "deleted"
  } catch (e) {
    const m = e instanceof MetaError ? e : (e as { meta?: MetaError } | null)?.meta
    // 100/33: el objeto no existe o ya no se puede acceder → ya no está publicado.
    if (m && (m.subcode === 33 || /does not exist|cannot be loaded|Unsupported delete/i.test(m.message))) {
      if (/Unsupported delete/i.test(m.message)) {
        throw new PermanentError("Instagram no permite borrar publicaciones por la API: abrilo y borralo desde la app")
      }
      return "already_gone"
    }
    throw e
  }
}

// ── Lectura genérica (métricas) ─────────────────────────────────────────────

/** GET a la Graph API (lo usa la recolección de métricas). Mismos errores que el resto. */
export function graphGet<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  return graph<T>("GET", path, token, params)
}

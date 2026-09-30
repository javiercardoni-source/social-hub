/**
 * Recolección de métricas (F1, .gauntlet/features/f1-analytics/spec.md).
 *
 * Por cuenta: trae lo publicado (histórico paginado la primera vez, reanudable), las historias
 * vivas, los seguidores del día, y mide cada publicación según su edad. Cada corrida tiene un
 * tope de llamadas a Meta; si queda trabajo, se vuelve a encolar sola.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { graphGet, tokenFor, isTokenError } from "./meta.ts"
import { supabaseStorage } from "./storage.ts"
import { withTmp, writeTmp } from "./media.ts"
import { isDue } from "../../shared/cos/metrics-due.ts"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

const run = promisify(execFile)

type Format = "feed" | "reel" | "story" | "carousel" | "video"
type Account = {
  id: string
  brand_id: string
  platform: "instagram" | "facebook"
  external_id: string
  token_ref: string | null
  metrics_backfill_cursor: string | null
  metrics_backfill_done: boolean
}
type Log = (msg: string, extra?: Record<string, unknown>) => void

// Métricas que Meta entrega hoy por tipo (probado el 28-09 contra v26).
const IG_METRICS: Record<Format, string> = {
  feed: "reach,views,likes,comments,saved,shares,total_interactions,follows,profile_visits",
  carousel: "reach,views,likes,comments,saved,shares,total_interactions,follows,profile_visits",
  video: "reach,views,likes,comments,saved,shares,total_interactions",
  reel: "reach,views,likes,comments,saved,shares,total_interactions,ig_reels_avg_watch_time",
  story: "reach,views,shares,total_interactions,follows,profile_visits,replies,navigation",
}

const MAX_INSIGHT_CALLS = 90 // por corrida: holgado frente a los límites de Meta
const MAX_PAGES = 4
const MAX_THUMBS = 40
const HOUR = 3600_000

function igFormat(product: string | undefined, type: string | undefined): Format {
  if (product === "STORY") return "story"
  if (product === "REELS") return "reel"
  if (type === "CAROUSEL_ALBUM") return "carousel"
  if (type === "VIDEO") return "video"
  return "feed"
}

type IgMedia = {
  id: string
  media_type?: string
  media_product_type?: string
  caption?: string
  permalink?: string
  timestamp: string
  media_url?: string
  thumbnail_url?: string
}

const IG_FIELDS = "id,media_type,media_product_type,caption,permalink,timestamp,media_url,thumbnail_url"

async function upsertMedia(db: SupabaseClient, acc: Account, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  // No se pisa lo que ya se midió: solo los datos de la publicación.
  const { error } = await db.from("cos_media").upsert(rows, { onConflict: "platform,remote_id" })
  if (error) throw new Error(`cos_media: ${error.message}`)
}

/**
 * URL fresca de la imagen de una publicación vieja (la que se guardó al listar ya venció, o nunca
 * se guardó porque el histórico se recorrió antes de que hubiera miniaturas). Solo lectura.
 */
export async function freshThumbUrl(platform: string, remoteId: string, token: string): Promise<string | null> {
  if (platform === "instagram") {
    const m = await graphGet<{ media_url?: string; thumbnail_url?: string }>(remoteId, token, { fields: "media_url,thumbnail_url" })
    return m.thumbnail_url ?? m.media_url ?? null
  }
  const p = await graphGet<{ full_picture?: string }>(remoteId, token, { fields: "full_picture" })
  return p.full_picture ?? null
}

/** Miniatura propia (las URLs de Meta vencen): 320 px de ancho, JPEG. */
export async function saveThumb(db: SupabaseClient, key: string, url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`miniatura ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const jpg = await withTmp(async (dir) => {
    const f = await writeTmp(dir, "in", buf)
    const out = join(dir, "t.jpg")
    await run("ffmpeg", ["-y", "-i", f, "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "5", out], { timeout: 60_000 })
    return readFile(out)
  })
  await supabaseStorage(db).upload(key, jpg, "image/jpeg")
}

/** Página siguiente del histórico. Si Meta dice "hay más" sin dar el puntero, se corta con error
 *  (no se marca el histórico como terminado por error). */
function nextCursor(paging: { cursors?: { after?: string }; next?: string } | undefined): string | null {
  if (!paging?.next) return null
  if (!paging.cursors?.after) throw new Error("Meta indicó más páginas sin cursor: se reintenta")
  return paging.cursors.after
}

type Pending = { more: boolean; measured: number; listed: number; thumbs: number }

export async function syncAccount(db: SupabaseClient, acc: Account, log: Log): Promise<Pending> {
  const token = tokenFor(acc.token_ref)
  const urls = new Map<string, string>() // remote_id → url fresca de la miniatura (solo esta corrida)
  let listed = 0
  let more = false

  try {
    if (acc.platform === "instagram") {
      // 1. Seguidores del día (Meta no da el histórico: lo vamos armando nosotros).
      const prof = await graphGet<{ followers_count?: number; media_count?: number }>(acc.external_id, token, {
        fields: "followers_count,media_count",
      })
      const day = new Date(Date.now() - 3 * HOUR).toISOString().slice(0, 10)
      await db.from("cos_account_daily").upsert({ account_id: acc.id, day, followers: prof.followers_count ?? null, media_count: prof.media_count ?? null })

      // 2. Publicaciones: histórico paginado (reanudable) o solo lo reciente.
      let cursor = acc.metrics_backfill_done ? null : acc.metrics_backfill_cursor
      for (let page = 0; page < (acc.metrics_backfill_done ? 1 : MAX_PAGES); page++) {
        const r = await graphGet<{ data: IgMedia[]; paging?: { cursors?: { after?: string }; next?: string } }>(`${acc.external_id}/media`, token, {
          fields: IG_FIELDS,
          limit: "50",
          ...(cursor ? { after: cursor } : {}),
        })
        await upsertMedia(
          db,
          acc,
          r.data.map((m) => ({
            account_id: acc.id,
            brand_id: acc.brand_id,
            platform: "instagram",
            remote_id: m.id,
            format: igFormat(m.media_product_type, m.media_type),
            caption: m.caption ?? null,
            permalink: m.permalink ?? null,
            posted_at: m.timestamp,
          })),
        )
        for (const m of r.data) {
          const u = m.thumbnail_url ?? m.media_url
          if (u) urls.set(m.id, u)
        }
        listed += r.data.length
        if (acc.metrics_backfill_done) break
        cursor = nextCursor(r.paging)
        await db
          .from("cos_social_accounts")
          .update({ metrics_backfill_cursor: cursor, metrics_backfill_done: !cursor })
          .eq("id", acc.id)
        if (!cursor) break
        if (page === MAX_PAGES - 1) more = true
      }

      // 3. Historias vivas (sus métricas se pierden a las 24 h).
      const st = await graphGet<{ data: IgMedia[] }>(`${acc.external_id}/stories`, token, { fields: IG_FIELDS })
      await upsertMedia(
        db,
        acc,
        st.data.map((m) => ({
          account_id: acc.id,
          brand_id: acc.brand_id,
          platform: "instagram",
          remote_id: m.id,
          format: "story",
          caption: m.caption ?? null,
          permalink: m.permalink ?? null,
          posted_at: m.timestamp,
        })),
      )
      for (const m of st.data) {
        const u = m.thumbnail_url ?? m.media_url
        if (u) urls.set(m.id, u)
      }
      listed += st.data.length
    } else {
      // Facebook: las publicaciones de la página, con reacciones/comentarios/compartidos.
      let cursor = acc.metrics_backfill_done ? null : acc.metrics_backfill_cursor
      for (let page = 0; page < (acc.metrics_backfill_done ? 1 : MAX_PAGES); page++) {
        const r = await graphGet<{
          data: { id: string; created_time: string; message?: string; permalink_url?: string; full_picture?: string; attachments?: { data?: { media_type?: string }[] } }[]
          paging?: { cursors?: { after?: string }; next?: string }
        }>(`${acc.external_id}/published_posts`, token, {
          fields: "id,created_time,message,permalink_url,full_picture,attachments{media_type}",
          limit: "50",
          ...(cursor ? { after: cursor } : {}),
        })
        await upsertMedia(
          db,
          acc,
          r.data.map((p) => ({
            account_id: acc.id,
            brand_id: acc.brand_id,
            platform: "facebook",
            remote_id: p.id,
            format: p.attachments?.data?.[0]?.media_type === "video" ? "video" : "feed",
            caption: p.message ?? null,
            permalink: p.permalink_url ?? null,
            posted_at: p.created_time,
          })),
        )
        for (const p of r.data) if (p.full_picture) urls.set(p.id, p.full_picture)
        listed += r.data.length
        if (acc.metrics_backfill_done) break
        cursor = nextCursor(r.paging)
        await db
          .from("cos_social_accounts")
          .update({ metrics_backfill_cursor: cursor, metrics_backfill_done: !cursor })
          .eq("id", acc.id)
        if (!cursor) break
        if (page === MAX_PAGES - 1) more = true
      }
    }

    // 4. Medir lo que toca, según su edad (y todo lo nunca medido, de a tandas).
    const { data: rows, error } = await db
      .from("cos_media")
      .select("id, remote_id, format, posted_at, metrics_at, thumb_key")
      .eq("account_id", acc.id)
      .order("metrics_at", { ascending: true, nullsFirst: true })
      .order("posted_at", { ascending: false })
      .limit(2000)
    if (error) throw new Error(`cos_media: ${error.message}`)
    const due = (rows ?? []).filter((r) => isDue(r.posted_at, r.metrics_at, Date.now(), r.format))
    if (due.length > MAX_INSIGHT_CALLS) more = true
    let measured = 0
    for (const m of due.slice(0, MAX_INSIGHT_CALLS)) {
      const values = await measure(acc, token, m.remote_id, m.format as Format)
      const now = new Date()
      const ageHours = Math.max(0, (now.getTime() - new Date(m.posted_at).getTime()) / HOUR)
      if (values.ok) {
        await db
          .from("cos_media_metrics")
          .upsert({ media_id: m.id, captured_at: now.toISOString(), age_hours: Math.round(ageHours * 100) / 100, data: values.data }, {
            onConflict: "media_id,captured_hour",
            ignoreDuplicates: true,
          })
        await db.from("cos_media").update({ metrics: values.data, metrics_at: now.toISOString(), metrics_error: null }).eq("id", m.id)
      } else {
        // Sin datos (historia vencida, post sin métricas): se anota y no se reintenta hasta la próxima ventana.
        await db.from("cos_media").update({ metrics_at: now.toISOString(), metrics_error: values.error }).eq("id", m.id)
      }
      measured++
    }

    // 5. Miniaturas propias de lo que no tiene.
    let thumbs = 0
    for (const r of (rows ?? []).filter((x) => !x.thumb_key && urls.has(x.remote_id)).slice(0, MAX_THUMBS)) {
      const key = `analytics/${acc.platform}/${r.remote_id}.jpg`
      try {
        await saveThumb(db, key, urls.get(r.remote_id)!)
        await db.from("cos_media").update({ thumb_key: key }).eq("id", r.id)
        thumbs++
      } catch (e) {
        log("no se pudo guardar la miniatura", { media: r.id, error: String(e) })
      }
    }
    if ((rows ?? []).filter((x) => !x.thumb_key && urls.has(x.remote_id)).length > MAX_THUMBS) more = true

    // 6. Vincular con los posts de Content OS.
    const { data: ours } = await db.from("cos_posts").select("id, remote_post_id").eq("account_id", acc.id).not("remote_post_id", "is", null)
    for (const p of ours ?? []) {
      await db.from("cos_media").update({ post_id: p.id }).eq("platform", acc.platform).eq("remote_id", p.remote_post_id).is("post_id", null)
    }

    await db.from("cos_social_accounts").update({ metrics_synced_at: new Date().toISOString(), metrics_error: null }).eq("id", acc.id)
    return { more, measured, listed, thumbs }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await db.from("cos_social_accounts").update({ metrics_error: message.slice(0, 500) }).eq("id", acc.id)
    if (isTokenError(e)) await db.from("cos_social_accounts").update({ status: "error", last_error: message }).eq("id", acc.id)
    throw e
  }
}

async function measure(acc: Account, token: string, remoteId: string, format: Format): Promise<{ ok: true; data: Record<string, number> } | { ok: false; error: string }> {
  if (acc.platform === "facebook") {
    try {
      const r = await graphGet<{
        reactions?: { summary?: { total_count?: number } }
        comments?: { summary?: { total_count?: number } }
        shares?: { count?: number }
      }>(remoteId, token, { fields: "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares" })
      const data: Record<string, number> = {
        likes: r.reactions?.summary?.total_count ?? 0,
        comments: r.comments?.summary?.total_count ?? 0,
        shares: r.shares?.count ?? 0,
      }
      data.total_interactions = data.likes + data.comments + data.shares
      // Vistas: no todas las publicaciones las tienen; si falla, se sigue sin ellas.
      const ins = await graphGet<{ data: { name: string; values?: { value?: number }[] }[] }>(`${remoteId}/insights`, token, {
        metric: "post_media_view,post_total_media_view_unique",
      }).catch(() => null)
      for (const d of ins?.data ?? []) {
        const v = d.values?.[0]?.value
        // Meta a veces devuelve alcance 0 con vistas reales: un 0 así no se guarda como alcance.
        if (typeof v === "number" && (d.name === "post_media_view" || v > 0)) data[d.name === "post_media_view" ? "views" : "reach"] = v
      }
      return { ok: true, data }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  const list = IG_METRICS[format]
  const parse = (r: { data: { name: string; values?: { value?: number }[]; total_value?: { value?: number } }[] }) => {
    const out: Record<string, number> = {}
    for (const d of r.data) {
      const v = d.total_value?.value ?? d.values?.[0]?.value
      if (typeof v === "number") out[d.name] = v
    }
    return out
  }
  try {
    return { ok: true, data: parse(await graphGet(`${remoteId}/insights`, token, { metric: list })) }
  } catch (e) {
    let last = e instanceof Error ? e.message : String(e)
    // Solo si el problema es una métrica puntual se piden de a una (si no, se gastan llamadas).
    if (!/metric/i.test(last)) return { ok: false, error: last.slice(0, 300) }
    const out: Record<string, number> = {}
    for (const m of list.split(",")) {
      try {
        Object.assign(out, parse(await graphGet(`${remoteId}/insights`, token, { metric: m })))
      } catch (err) {
        last = err instanceof Error ? err.message : String(err)
      }
    }
    return Object.keys(out).length ? { ok: true, data: out } : { ok: false, error: last.slice(0, 300) }
  }
}

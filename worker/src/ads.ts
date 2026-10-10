/**
 * F10 · Motor de ADS (docs/PLAN-MOTOR-ADS.md). Trabajos CORTOS a propósito: el worker hace uno a
 * la vez y no puede frenar las publicaciones. Lo largo se parte y se re-encola solo.
 *
 *   ads:sync    (account_id, mes?)   anuncios de la cuenta + insights de UN mes por corrida; el
 *                                    último mes cierra con los totales y pide miniaturas/revisiones
 *   ads:media   (ad_id, video?)      miniatura (y video, si está rankeado) propios en cos-media
 *   ads:review  (ad_id)              filtro de seguridad de un ganador (IA mirando cuadros)
 *   ads:batch   (brand_id?, rehacer?) la tanda semanal (espera las revisiones que falten)
 *   ads:piece   (proposal_id)        arma la pieza: re-edición (9:16 + 4:5) u orgánico bajado de IG
 *   ads:create  (proposal_id)        crea en Meta PAUSADO, UNA escritura por corrida, 10 s entre cada una
 *
 * Reglas (no se negocian): nunca ACTIVE, nunca se toca lo que ya corre; precio solo en el texto;
 * nada de «sin TACC»; números de Meta de cost_per_action_type; lecturas sin pausa.
 */
import { readFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { join } from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Handler } from "./handlers.ts"
import { brandContext, settings } from "./handlers.ts"
import { PermanentError, type Queue } from "./queue.ts"
import { graph, tokenFor } from "./meta.ts"
import { supabaseStorage } from "./storage.ts"
import { fitForInstagramFeed, framesAt, probe, thumbnail, toJpeg, withTmp, writeTmp } from "./media.ts"
import { kitDeMarca } from "./overlay.ts"
import { exists, loadKit } from "./render.ts"
import { armarReel } from "./reel.ts"
import { elegirVisuales, escribirAnuncio, revisarPieza, REVISION_VERSION } from "./ads-ai.ts"
import {
  aCentavos,
  aprendizaje,
  desdeCentavos,
  elegirPlantilla,
  elegirTanda,
  grupoTitular,
  guionRearmado,
  guionReedicion,
  leerInsights,
  porQueAnuncio,
  problemasCopy,
  rankearAnuncios,
  tipoCreativo,
  titularVigente,
  tramosLimpios,
  type CreativoMeta,
  type FilaInsights,
  type Numeros,
  type Revision,
  type TipoPropuesta,
} from "../../shared/cos/ads.ts"
import { candidatosPauta, lunesDe } from "../../shared/cos/sugerencias.ts"
import { cierreDesdeDatos } from "../../shared/cos/reel.ts"
import { slugVitrina } from "../../shared/cos/vitrina.ts"
import { normalizarDatos } from "../../shared/cos/datos-vigentes.ts"
import { normalizarRasgos, RASGO_CAMPOS } from "../../shared/cos/gustos.ts"
import type { Format } from "../../shared/cos/timing.ts"

const run = promisify(execFile)

/** Desde cuándo se lee (lo que juntó el Scheduler arranca en dic-2025). */
export const ADS_DESDE = "2025-12-01"
/** Pausa entre escrituras en Meta (anti-baneo, reglas del Meta Ads Center). */
const PAUSA_ESCRITURA_MS = 10_000
/** Cuántos ganadores por marca se revisan y se bajan (video). */
const TOP_REVISAR = 12

export const AD_FIELDS = [
  "id,name,status,effective_status,created_time",
  "campaign{id,name,objective}",
  "adset{id,name,daily_budget,lifetime_budget,optimization_goal,destination_type,targeting}",
  "creative{id,title,body,call_to_action_type,image_url,image_hash,video_id,object_type,effective_object_story_id,effective_instagram_media_id,instagram_permalink_url,object_story_spec}",
].join(",")
const INS_FIELDS = "ad_id,date_start,spend,impressions,reach,clicks,inline_link_clicks,actions,cost_per_action_type"

// ── utilidades ──────────────────────────────────────────────────────────────

const hoyAR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
function trozos<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}
function texto(job: { payload: Record<string, unknown> }, k: string): string {
  const v = job.payload[k]
  if (typeof v !== "string" || !v) throw new PermanentError(`payload sin ${k}`)
  return v
}
async function must<T = Record<string, unknown>>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>, que: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${que}: ${error.message}`)
  if (data == null) throw new PermanentError(`${que}: no existe`)
  return data as T
}

export type Pagina<T> = { data: T[]; paging?: { cursors?: { after?: string }; next?: string } }
/** Todas las páginas de una lectura (con el cursor `after`). */
export async function todas<T>(path: string, token: string, params: Record<string, string>, max = 60): Promise<T[]> {
  const out: T[] = []
  let after: string | undefined
  for (let i = 0; i < max; i++) {
    const r = await graph<Pagina<T>>("GET", path, token, { ...params, after })
    out.push(...(r.data ?? []))
    after = r.paging?.cursors?.after
    if (!r.paging?.next || !after) break
  }
  return out
}

async function bajarUrl(url: string, maxBytes = 300 * 1024 * 1024): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`no pude bajar el archivo de Meta (HTTP ${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) throw new PermanentError("el archivo es demasiado grande")
  return buf
}

type Cuenta = { id: string; token_ref: string; insights_until: string | null; currency: string | null }
async function cuenta(db: SupabaseClient, id: string): Promise<Cuenta> {
  return must<Cuenta>(db.from("cos_ad_accounts").select("id, token_ref, insights_until, currency").eq("id", id).single(), `cuenta ${id}`)
}

/** Página de Facebook / usuario de Instagram → marca (de las cuentas conectadas en Content OS). */
export async function marcasPorPagina(db: SupabaseClient) {
  const { data } = await db.from("cos_social_accounts").select("brand_id, platform, external_id")
  const pagina = new Map<string, string>()
  const ig = new Map<string, string>()
  for (const a of data ?? []) (a.platform === "facebook" ? pagina : ig).set(a.external_id as string, a.brand_id as string)
  return { pagina, ig }
}

// ── Ingesta (E1) ────────────────────────────────────────────────────────────

export type AnuncioMeta = {
  id: string
  name?: string
  status?: string
  effective_status?: string
  created_time?: string
  campaign?: { id: string; name?: string; objective?: string }
  adset?: { id: string; name?: string; daily_budget?: string; lifetime_budget?: string; optimization_goal?: string; destination_type?: string; targeting?: unknown }
  creative?: CreativoMeta & {
    id: string
    title?: string
    body?: string
    call_to_action_type?: string
    image_url?: string
    effective_object_story_id?: string
    instagram_permalink_url?: string
    object_story_spec?: CreativoMeta["object_story_spec"] & {
      page_id?: string
      instagram_user_id?: string
      video_data?: { video_id?: string; title?: string; message?: string; call_to_action?: { type?: string; value?: unknown }; page_welcome_message?: string }
      link_data?: { image_hash?: string; name?: string; message?: string; link?: string; call_to_action?: { type?: string; value?: unknown }; page_welcome_message?: string }
    }
  }
}

export function filaAnuncio(a: AnuncioMeta, accountId: string, m: { pagina: Map<string, string>; ig: Map<string, string> }) {
  const cr = a.creative
  const oss = cr?.object_story_spec
  const vd = oss?.video_data
  const ld = oss?.link_data
  const cta = vd?.call_to_action ?? ld?.call_to_action
  const pageId = oss?.page_id ?? cr?.effective_object_story_id?.split("_")[0] ?? null
  const igUser = oss?.instagram_user_id ?? null
  return {
    id: a.id,
    ad_account_id: accountId,
    brand_id: (pageId && m.pagina.get(pageId)) || (igUser && m.ig.get(igUser)) || null,
    page_id: pageId,
    ig_user_id: igUser,
    name: a.name ?? null,
    status: a.status ?? null,
    effective_status: a.effective_status ?? null,
    created_time: a.created_time ?? null,
    campaign_id: a.campaign?.id ?? null,
    campaign_name: a.campaign?.name ?? null,
    objective: a.campaign?.objective ?? null,
    adset_id: a.adset?.id ?? null,
    adset_name: a.adset?.name ?? null,
    daily_budget: desdeCentavos(a.adset?.daily_budget),
    lifetime_budget: desdeCentavos(a.adset?.lifetime_budget),
    optimization_goal: a.adset?.optimization_goal ?? null,
    destination_type: a.adset?.destination_type ?? null,
    targeting: a.adset?.targeting ?? null,
    creative_id: cr?.id ?? null,
    creative_kind: tipoCreativo(cr),
    object_type: cr?.object_type ?? null,
    title: vd?.title ?? ld?.name ?? cr?.title ?? null,
    body: vd?.message ?? ld?.message ?? cr?.body ?? null,
    cta_type: cta?.type ?? cr?.call_to_action_type ?? null,
    cta_value: cta?.value ?? null,
    welcome_message: vd?.page_welcome_message ?? ld?.page_welcome_message ?? null,
    video_id: vd?.video_id ?? cr?.video_id ?? null,
    image_hash: ld?.image_hash ?? oss?.photo_data?.image_hash ?? cr?.image_hash ?? null,
    image_url: cr?.image_url ?? null,
    story_id: cr?.effective_object_story_id ?? null,
    ig_media_id: cr?.effective_instagram_media_id ?? null,
    permalink: cr?.instagram_permalink_url ?? null,
    updated_at: new Date().toISOString(),
  }
}

export async function guardarAnuncios(db: SupabaseClient, filas: ReturnType<typeof filaAnuncio>[]) {
  for (const t of trozos(filas, 200)) {
    const { error } = await db.from("cos_ads").upsert(t, { onConflict: "id" })
    if (error) throw new Error(`cos_ads: ${error.message}`)
  }
}

/** Primer día del mes siguiente (YYYY-MM-01). */
function mesSiguiente(mes: string): string {
  const d = new Date(`${mes.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 1)
  return d.toISOString().slice(0, 10)
}
function finDeMes(mes: string): string {
  const d = new Date(`${mesSiguiente(mes)}T00:00:00Z`)
  d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}

const sync: Handler = async (job, { db, queue, log }) => {
  const acc = await cuenta(db, texto(job, "account_id"))
  const token = tokenFor(acc.token_ref)
  const m = await marcasPorPagina(db)
  let mes = typeof job.payload.mes === "string" ? job.payload.mes : null

  if (!mes) {
    // Arranque de la corrida: datos de la cuenta y anuncios tocados desde nov-2025.
    const info = await graph<{ name?: string; currency?: string; timezone_name?: string }>("GET", acc.id, token, { fields: "name,currency,timezone_name" })
    await db.from("cos_ad_accounts").update({ name: info.name, currency: info.currency, timezone: info.timezone_name }).eq("id", acc.id)
    const desde = Math.floor(Date.parse("2025-11-01T00:00:00Z") / 1000)
    const ads = await todas<AnuncioMeta>(`${acc.id}/ads`, token, {
      fields: AD_FIELDS,
      limit: "100",
      filtering: JSON.stringify([{ field: "updated_time", operator: "GREATER_THAN", value: desde }]),
    })
    await guardarAnuncios(db, ads.map((a) => filaAnuncio(a, acc.id, m)))
    // Se repasan los últimos 7 días (Meta atribuye conversaciones hasta 7 días después).
    const base = acc.insights_until ? new Date(Date.parse(`${acc.insights_until}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10) : ADS_DESDE
    mes = base < ADS_DESDE ? ADS_DESDE : base
    log("ads:sync anuncios", { cuenta: acc.id, anuncios: ads.length, desde: mes })
  }

  // Un mes (o lo que quede de él) de insights por anuncio y día.
  const hoy = hoyAR()
  const since = mes
  const until = finDeMes(mes) < hoy ? finDeMes(mes) : hoy
  const filas = await todas<FilaInsights & { ad_id: string; date_start: string }>(`${acc.id}/insights`, token, {
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: INS_FIELDS,
    limit: "500",
  })
  // Anuncios con números que no vinieron en la lista (más viejos que nov-2025): se traen por id.
  const ids = [...new Set(filas.map((f) => f.ad_id))]
  const conocidos = new Set<string>()
  for (const t of trozos(ids, 200)) {
    const { data } = await db.from("cos_ads").select("id").in("id", t)
    for (const r of data ?? []) conocidos.add(r.id as string)
  }
  const faltan = ids.filter((i) => !conocidos.has(i))
  // (v26 ya no acepta ?ids=: se piden de a uno, cinco a la vez; son lecturas.)
  for (const t of trozos(faltan, 5)) {
    const r = await Promise.all(t.map((id) => graph<AnuncioMeta>("GET", id, token, { fields: AD_FIELDS }).catch(() => null)))
    const ok = r.filter((a): a is AnuncioMeta => !!a)
    await guardarAnuncios(db, ok.map((a) => filaAnuncio(a, acc.id, m)))
    for (const a of ok) conocidos.add(a.id)
  }
  // Lo que Meta ya no devuelve (borrado) no entra: sin anuncio no hay dónde colgar los números.
  const diarias = filas.filter((f) => conocidos.has(f.ad_id)).map((f) => {
    const n = leerInsights(f)
    return { ad_id: f.ad_id, date: f.date_start, ...n, actions: f.actions ?? null }
  })
  for (const t of trozos(diarias, 500)) {
    const { error } = await db.from("cos_ad_daily").upsert(t, { onConflict: "ad_id,date" })
    if (error) throw new Error(`cos_ad_daily: ${error.message}`)
  }
  if (!acc.insights_until || until > acc.insights_until) await db.from("cos_ad_accounts").update({ insights_until: until }).eq("id", acc.id)
  log("ads:sync mes", { cuenta: acc.id, since, until, filas: diarias.length })

  if (until < hoy) {
    const sig = mesSiguiente(mes)
    await queue.enqueue("ads:sync", { account_id: acc.id, mes: sig }, { dedupeKey: `ads:sync:${acc.id}:${sig}:${hoy}` })
    return
  }
  await cerrarSync(db, queue, acc, token, log)
}

/** Último paso: totales del período por anuncio (la cuenta grande no aguanta todo junto). */
async function cerrarSync(db: SupabaseClient, queue: Queue, acc: Cuenta, token: string, log: (m: string, e?: Record<string, unknown>) => void) {
  const hoy = hoyAR()
  const conGasto = new Map<string, { first: string; last: string }>()
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db
      .from("cos_ad_daily")
      .select("ad_id, date, cos_ads!inner(ad_account_id)")
      .eq("cos_ads.ad_account_id", acc.id)
      .gt("spend", 0)
      .order("date")
      .range(desde, desde + 999)
    if (error) throw new Error(`cos_ad_daily: ${error.message}`)
    for (const r of data ?? []) {
      const x = conGasto.get(r.ad_id as string)
      if (!x) conGasto.set(r.ad_id as string, { first: r.date as string, last: r.date as string })
      else x.last = r.date as string
    }
    if (!data || data.length < 1000) break
  }
  const ids = [...conGasto.keys()]
  // Solo se vuelven a pedir los totales de lo que gastó en los últimos 10 días (Meta atribuye hasta 7)
  // o de lo que todavía no tiene: lo demás no cambia. La app de Meta es LA MISMA que usa el Scheduler
  // para prender y pausar campañas: pedir los ~900 de nuevo cada día agotó el cupo (#4) el 01-10.
  const corte = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10)
  const sinTotales = new Set<string>()
  for (const t of trozos(ids, 200)) {
    const { data } = await db.from("cos_ads").select("id, totals").in("id", t)
    for (const r of data ?? []) if (!(r.totals as { spend?: number } | null)?.spend) sinTotales.add(r.id as string)
  }
  const pedir = ids.filter((id) => sinTotales.has(id) || (conGasto.get(id)?.last ?? "") >= corte)
  // Las fechas de primer/último gasto sí se actualizan para todos (salen de la base, sin Meta).
  for (const id of ids.filter((x) => !pedir.includes(x))) {
    const f = conGasto.get(id)!
    await db.from("cos_ads").update({ first_date: f.first, last_date: f.last }).eq("id", id)
  }
  // Por anuncio (5 a la vez): filtrando por id desde la cuenta, Meta omite los archivados y los
  // viejos (uno de ellos gastó $2,4 M). Son lecturas: sin pausa.
  for (const t of trozos(pedir, 5)) {
    const r = await Promise.all(
      t.map((id) =>
        graph<{ data: FilaInsights[] }>("GET", `${id}/insights`, token, {
          time_range: JSON.stringify({ since: ADS_DESDE, until: hoy }),
          fields: "spend,impressions,reach,clicks,inline_link_clicks,actions,cost_per_action_type",
        }).then((x) => ({ id, f: x.data?.[0] ?? null })),
      ),
    )
    for (const { id, f } of r) {
      const fechas = conGasto.get(id)
      const { error } = await db
        .from("cos_ads")
        .update({ totals: f ? leerInsights(f) : {}, first_date: fechas?.first ?? null, last_date: fechas?.last ?? null })
        .eq("id", id)
      if (error) throw new Error(`cos_ads totales: ${error.message}`)
    }
  }
  await db.from("cos_ad_accounts").update({ synced_at: new Date().toISOString(), last_error: null }).eq("id", acc.id)
  log("ads:sync listo", { cuenta: acc.id, anuncios_con_gasto: ids.length })

  // Miniaturas de todo lo que gastó; revisiones de los ganadores de cada marca.
  const { data: sinFoto } = await db.from("cos_ads").select("id").eq("ad_account_id", acc.id).is("thumb_key", null).is("media_error", null)
  for (const a of (sinFoto ?? []).filter((x) => conGasto.has(x.id as string))) await queue.enqueue("ads:media", { ad_id: a.id }, { dedupeKey: `ads:media:${a.id}` })
  const { data: marcas } = await db.from("cos_ads").select("brand_id").eq("ad_account_id", acc.id).not("brand_id", "is", null)
  for (const b of new Set((marcas ?? []).map((x) => x.brand_id as string))) await pedirRevisiones(db, queue, b)
}

// ── Medios ──────────────────────────────────────────────────────────────────

export type AnuncioFila = ReturnType<typeof filaAnuncio> & {
  thumb_key: string | null
  video_key: string | null
  totals: Partial<Numeros>
  revision: Revision | null
  revision_version: number | null
  last_date: string | null
  media_error: string | null
}
export async function anuncio(db: SupabaseClient, id: string): Promise<AnuncioFila> {
  return must(db.from("cos_ads").select("*").eq("id", id).single(), `anuncio ${id}`) as Promise<AnuncioFila>
}

/** Dónde bajar la imagen y el video de un anuncio (los links de Meta vencen: se piden en el momento). */
async function urlsDeMedios(db: SupabaseClient, a: AnuncioFila, token: string): Promise<{ imagen: string | null; video: string | null }> {
  if (a.creative_kind === "video" && a.video_id) {
    const v = await graph<{ source?: string; picture?: string; thumbnails?: { data: { uri: string; is_preferred?: boolean; width?: number }[] } }>("GET", a.video_id, token, {
      fields: "source,picture,thumbnails{uri,is_preferred,width}",
    })
    const thumbs = v.thumbnails?.data ?? []
    const pref = thumbs.find((t) => t.is_preferred) ?? [...thumbs].sort((x, y) => (y.width ?? 0) - (x.width ?? 0))[0]
    return { imagen: pref?.uri ?? v.picture ?? a.image_url, video: v.source ?? null }
  }
  if (a.image_hash) {
    const r = await graph<{ data: { url?: string }[] }>("GET", `${a.ad_account_id}/adimages`, token, { hashes: JSON.stringify([a.image_hash]), fields: "url" })
    if (r.data?.[0]?.url) return { imagen: r.data[0].url, video: null }
  }
  if (a.ig_media_id) {
    // Publicación de Instagram promocionada: si ya está en la Biblioteca de métricas, su miniatura.
    const { data: m } = await db.from("cos_media").select("thumb_key").eq("remote_id", a.ig_media_id).maybeSingle()
    try {
      const r = await graph<{ media_type?: string; media_url?: string; thumbnail_url?: string }>("GET", a.ig_media_id, token, { fields: "media_type,media_url,thumbnail_url" })
      return { imagen: r.thumbnail_url ?? (r.media_type === "VIDEO" ? null : r.media_url ?? null), video: r.media_type === "VIDEO" ? r.media_url ?? null : null }
    } catch (e) {
      if (m?.thumb_key) return { imagen: null, video: null }
      throw e
    }
  }
  return { imagen: a.image_url, video: null }
}

/** Guarda miniatura (y video si `conVideo`) en cos-media. Devuelve la fila actualizada. */
export async function asegurarMedios(db: SupabaseClient, a: AnuncioFila, conVideo: boolean): Promise<AnuncioFila> {
  if (a.thumb_key && (!conVideo || a.video_key || a.creative_kind !== "video")) return a
  const acc = await cuenta(db, a.ad_account_id)
  const token = tokenFor(acc.token_ref)
  const st = supabaseStorage(db)
  const u = await urlsDeMedios(db, a, token)
  const cambios: Record<string, string | null> = { media_error: null }
  await withTmp(async (dir) => {
    if (conVideo && u.video && !a.video_key) {
      const key = `ads/${a.id}/video.mp4`
      if (!(await exists(db, key))) await st.upload(key, await bajarUrl(u.video), "video/mp4")
      cambios.video_key = key
    }
    if (!a.thumb_key) {
      const key = `ads/${a.id}/thumb.jpg`
      let jpg: Buffer | null = null
      if (u.imagen) jpg = await toJpeg(await writeTmp(dir, "img", await bajarUrl(u.imagen, 40 * 1024 * 1024)), dir)
      else if (u.video) {
        const f = await writeTmp(dir, "vid.mp4", cambios.video_key ? await st.download(cambios.video_key) : await bajarUrl(u.video))
        jpg = await thumbnail(f, await probe(f, "video/mp4"), dir)
      }
      if (jpg) {
        if (!(await exists(db, key))) await st.upload(key, jpg, "image/jpeg")
        cambios.thumb_key = key
      } else cambios.media_error = "Meta no dio imagen para este anuncio"
    }
  })
  await db.from("cos_ads").update(cambios).eq("id", a.id)
  return { ...a, ...cambios } as AnuncioFila
}

const media: Handler = async (job, { db }) => {
  const a = await anuncio(db, texto(job, "ad_id"))
  try {
    await asegurarMedios(db, a, job.payload.video === true)
  } catch (e) {
    // Un anuncio viejo puede no tener ya su archivo en Meta: queda anotado y no se reintenta.
    if (e instanceof PermanentError || (e as { meta?: unknown }).meta) {
      await db.from("cos_ads").update({ media_error: String((e as Error).message).slice(0, 300) }).eq("id", a.id)
      return
    }
    throw e
  }
}

// ── Revisión (E2) ───────────────────────────────────────────────────────────

async function anunciosDeMarca(db: SupabaseClient, brandId: string): Promise<AnuncioFila[]> {
  const out: AnuncioFila[] = []
  for (let d = 0; ; d += 1000) {
    const { data, error } = await db.from("cos_ads").select("*").eq("brand_id", brandId).gt("totals->>spend", "0").range(d, d + 999)
    if (error) throw new Error(`cos_ads: ${error.message}`)
    out.push(...((data ?? []) as AnuncioFila[]))
    if (!data || data.length < 1000) break
  }
  return out
}

/** Encola la revisión de los ganadores de la marca que todavía no la tienen (o la tienen vieja). */
export async function pedirRevisiones(db: SupabaseClient, queue: Queue, brandId: string): Promise<number> {
  const ads = await anunciosDeMarca(db, brandId)
  const r = rankearAnuncios(ads)
  const top = r.ganadores.slice(0, TOP_REVISAR).map((g) => ads.find((a) => a.id === g.id)!)
  const faltan = top.filter((a) => a.revision_version !== REVISION_VERSION)
  for (const a of faltan) await queue.enqueue("ads:review", { ad_id: a.id }, { dedupeKey: `ads:review:${a.id}:v${REVISION_VERSION}` })
  return faltan.length
}

const review: Handler = async (job, { db, log }) => {
  let a = await anuncio(db, texto(job, "ad_id"))
  if (!a.brand_id || a.revision_version === REVISION_VERSION) return
  try {
    a = await asegurarMedios(db, a, true)
  } catch (e) {
    if (!(e instanceof PermanentError) && !(e as { meta?: unknown }).meta) throw e
    await db.from("cos_ads").update({ media_error: String((e as Error).message).slice(0, 300) }).eq("id", a.id)
  }
  const s = await settings(db)
  const brand = await brandContext(db, a.brand_id ?? "")
  const st = supabaseStorage(db)
  const rev = await withTmp(async (dir) => {
    if (a.video_key) {
      const f = await writeTmp(dir, "v.mp4", await st.download(a.video_key))
      const dur = ((await probe(f, "video/mp4")).durationMs ?? 0) / 1000
      // Un cuadro cada ~1,2 s (máximo 14) para saber QUÉ partes están limpias.
      const n = Math.max(2, Math.min(14, Math.ceil(dur / 1.2)))
      const paso = dur / n
      const ts = Array.from({ length: n }, (_, i) => Math.min(dur - 0.05, paso / 2 + i * paso))
      const jpgs = await framesAt(f, ts, dir)
      return revisarPieza({ db, model: s.ai_model, brand, cuadros: ts.map((t, i) => ({ t, jpg: jpgs[i] })), duracion: dur })
    }
    if (a.thumb_key) return revisarPieza({ db, model: s.ai_model, brand, cuadros: [{ t: 0, jpg: await st.download(a.thumb_key) }], duracion: null })
    return null
  })
  const revision: Revision = rev ?? { apto: false, motivos: ["no hay archivo para revisar"], precio_quemado: false, sin_tacc: false, promo_vencida: false, ia_generada: false }
  await db.from("cos_ads").update({ revision, revision_version: REVISION_VERSION, revision_at: new Date().toISOString() }).eq("id", a.id)
  log("ads:review", { ad: a.id, apto: revision.apto, motivos: revision.motivos })
}

// ── Tanda semanal (E3) ──────────────────────────────────────────────────────

const DESTINO: Record<string, string> = {
  WHATSAPP_MESSAGE: "WhatsApp",
  MESSAGE_PAGE: "Messenger de Facebook",
  INSTAGRAM_MESSAGE: "mensaje directo de Instagram",
}
export const CIERRE_CTA: Record<string, string> = {
  WHATSAPP_MESSAGE: "Pedí por WhatsApp",
  INSTAGRAM_MESSAGE: "Pedí por mensaje",
  MESSAGE_PAGE: "Pedí por mensaje",
}

/** Tramos limpios de un video revisado (vacío si no es video o no se revisó). */
function tramos(a: AnuncioFila): [number, number][] {
  const r = a.revision
  if (!r?.cuadros?.length || !r.duracion) return []
  return tramosLimpios(r.cuadros, r.duracion)
}

/** Orgánicos de la marca que rindieron muy por encima de lo habitual (últimos 60 días). */
async function organicos(db: SupabaseClient, brandId: string, vigentes: { precios: string[]; promos: string[] }, pautados: Set<string>) {
  const desde = new Date(Date.now() - 60 * 86_400_000).toISOString()
  const { data } = await db.from("cos_media").select("id, account_id, remote_id, format, posted_at, metrics, traits, caption, permalink, pautado, thumb_key").eq("brand_id", brandId).eq("platform", "instagram").gte("posted_at", desde)
  const posts = (data ?? []).map((m) => ({
    id: m.id as string,
    account: m.account_id as string,
    format: m.format as Format,
    postedAt: m.posted_at as string,
    metrics: (m.metrics ?? {}) as Record<string, number>,
    rasgos: Object.fromEntries(RASGO_CAMPOS.map((c) => [c, normalizarRasgos(m.traits)[c]])),
    caption: (m.caption as string) ?? "",
    permalink: (m.permalink as string) ?? null,
    pautado: !!m.pautado || pautados.has(m.remote_id as string),
  }))
  const cand = candidatosPauta(posts, vigentes, Date.now(), 60)
  return cand.map((c) => ({ ...c, fila: (data ?? []).find((m) => m.id === c.media_id)! }))
}

const batch: Handler = async (job, { db, queue, log }) => {
  const week = lunesDe(new Date())
  const solo = typeof job.payload.brand_id === "string" ? job.payload.brand_id : null
  const intento = typeof job.payload.intento === "number" ? job.payload.intento : 0
  let q = db.from("cos_brands").select("id, slug, datos_vigentes").eq("active", true)
  if (solo) q = q.eq("id", solo)
  const { data: marcas } = await q
  const s = await settings(db)

  for (const b of marcas ?? []) {
    const { data: yaHay } = await db.from("cos_ad_proposals").select("id, status").eq("brand_id", b.id).eq("week", week)
    if (yaHay?.length && job.payload.rehacer !== true) continue
    const ads = await anunciosDeMarca(db, b.id)
    if (!ads.length) {
      log("ads:batch: la marca no tiene anuncios con gasto", { brand: b.slug })
      continue
    }
    // Las revisiones van en trabajos aparte: si faltan, se piden y la tanda vuelve en 5 minutos.
    const faltan = await pedirRevisiones(db, queue, b.id)
    if (faltan && intento < 8) {
      await queue.enqueue("ads:batch", { brand_id: b.id, rehacer: job.payload.rehacer === true, intento: intento + 1 }, {
        runAt: new Date(Date.now() + 5 * 60_000),
        dedupeKey: `ads:batch:${b.id}:${week}:${intento + 1}`,
      })
      log("ads:batch espera revisiones", { brand: b.slug, faltan })
      continue
    }
    if (job.payload.rehacer === true) {
      // Rehacer: se van las propuestas que nadie tocó todavía (lo aprobado y lo creado queda).
      await db.from("cos_ad_proposals").delete().eq("brand_id", b.id).eq("week", week).in("status", ["propuesta", "preparando", "descartada", "error"])
    }

    const datos = normalizarDatos(b.datos_vigentes)
    const precios = datos.combos.filter((c) => c.activo && c.precio).map((c) => c.precio)
    const vigentes = { precios, promos: datos.promos.map((p) => p.texto) }
    const ranking = rankearAnuncios(ads)
    const porId = new Map(ads.map((a) => [a.id, a]))
    const ganadores = ranking.ganadores.slice(0, TOP_REVISAR).map((g) => porId.get(g.id)!)

    // Fuentes usadas en las últimas 4 semanas (no se repiten) y resultados de lo creado (E5).
    const { data: previas } = await db.from("cos_ad_proposals").select("id, kind, status, source_key, source_ad_id, week").eq("brand_id", b.id).gte("week", new Date(Date.parse(week) - 28 * 86_400_000).toISOString().slice(0, 10))
    const usados = new Set((previas ?? []).filter((p) => p.status !== "descartada").map((p) => p.source_key as string))
    const { data: creadas } = await db.from("cos_ad_proposals").select("id, kind, source_ad_id").eq("brand_id", b.id).eq("status", "creada")
    const { data: hijos } = await db.from("cos_ads").select("proposal_id, totals").in("proposal_id", (creadas ?? []).map((c) => c.id as string).concat("00000000-0000-0000-0000-000000000000"))
    const aprendido = aprendizaje(
      (creadas ?? []).map((c) => {
        const t = (hijos ?? []).filter((h) => h.proposal_id === c.id).map((h) => h.totals as Partial<Numeros>)
        const spend = t.reduce((x, y) => x + (y.spend ?? 0), 0)
        const conversations = t.reduce((x, y) => x + (y.conversations ?? 0), 0)
        // El mejor de los anuncios de la propuesta (9:16 o 4:5): costo de la API, sin calcular.
        const cpcs = t.map((y) => y.cost_per_conversation).filter((x): x is number => x != null)
        const origen = c.source_ad_id ? porId.get(c.source_ad_id as string)?.totals.cost_per_conversation ?? ranking.habitual : ranking.habitual
        return { kind: c.kind as TipoPropuesta, nuevo: { cost_per_conversation: cpcs.length ? Math.min(...cpcs) : null, spend, conversations }, origen }
      }),
    )

    const pautados = new Set(ads.map((a) => a.ig_media_id).filter(Boolean) as string[])
    const orgs = await organicos(db, b.id, vigentes, pautados)
    const brand = await brandContext(db, b.id)
    // Revisión rápida de los orgánicos candidatos (miniatura): precio quemado / sin TACC / IA.
    const orgAptos: { media_id: string; apto: boolean }[] = []
    for (const o of orgs.slice(0, 3)) {
      if (!o.fila.thumb_key) continue
      const r = await revisarPieza({ db, model: s.ai_model, brand, cuadros: [{ t: 0, jpg: await supabaseStorage(db).download(o.fila.thumb_key as string) }], duracion: null }).catch(() => null)
      orgAptos.push({ media_id: o.media_id, apto: !!r?.apto })
    }

    const { count: nFotos } = await db.from("cos_media").select("id", { count: "exact", head: true }).eq("brand_id", b.id).eq("platform", "instagram").not("thumb_key", "is", null)
    const hayFotos = (nFotos ?? 0) > 0
    const eleccion = elegirTanda({
      ganadores: ganadores.map((a) => ({
        id: a.id,
        apto: !!a.revision?.apto && !a.media_error,
        // Re-editable: con partes limpias, o con un titular que se pueda rearmar sobre fotos reales.
        reeditable: (!!a.video_key && guionReedicion(tramos(a), { gancho: "", tituloCierre: "", recuadro: "", pie: null, idea: "" }) != null) || (!!titularVigente(a.revision?.titular) && !!a.thumb_key && hayFotos),
        tienePieza: !!(a.video_id || a.image_hash || a.video_key || a.thumb_key),
        grupo: grupoTitular(a.revision?.titular),
      })),
      organicos: orgAptos,
      usados: new Set([...usados]),
      combosActivos: datos.combos.filter((c) => c.activo).length,
      aprendido,
    })

    let hechas = 0
    for (const e of eleccion) {
      const src = e.ad_id ? porId.get(e.ad_id)! : null
      const org = e.media_id ? orgs.find((o) => o.media_id === e.media_id)! : null
      // Meta ya no deja crear anuncios en campañas de objetivo viejo: ahí se usa el mejor conjunto
      // de mensajes con objetivo nuevo de la marca (público y configuración que ya rindieron).
      const plantilla = elegirPlantilla(src, ads)
      if (!plantilla?.adset_id) {
        log("ads:batch: la marca no tiene un conjunto de mensajes con objetivo nuevo para copiar", { brand: b.slug })
        continue
      }
      const otraPlantilla = !!src && plantilla.id !== src.id
      const cta = plantilla.cta_type ?? "WHATSAPP_MESSAGE"
      const porQue =
        e.kind === "organico" && org
          ? `Rindió ${org.lift} veces lo habitual de la cuenta en ${org.destaca.join(", ") || "alcance"} y nunca se pautó. Va con el público y el presupuesto del mejor anuncio de la marca.`
          : `${e.kind === "reeditar" ? (src && guionReedicion(tramos(src), { gancho: "", tituloCierre: "", recuadro: "", pie: null, idea: "" }) ? "Ganador re-editado: solo las partes sin precio ni sello, otra apertura y la placa final actual. " : `Diseño ganador rearmado: el mismo titular («${titularVigente(src?.revision?.titular)}») sin precio, sobre fotos reales ya publicadas. `) : e.kind === "variante" ? "Mismo diseño del ganador, con el texto sobre otro combo. " : "Ganador de la marca, con texto nuevo. "}${porQueAnuncio(src!.totals, ranking.habitual)}`
      const notaPlantilla = otraPlantilla ? ` Va con el público del conjunto «${plantilla.adset_name ?? plantilla.adset_id}» (la campaña del ganador es de un objetivo que Meta ya no deja usar).` : ""
      const pieza = src
        ? [`Título original: ${src.title ?? "(sin título)"}`, `Texto original: ${src.body ?? "(sin texto)"}`, `Se ve: ${src.revision?.producto ?? "comida de la marca"}`, ...(titularVigente(src.revision?.titular) ? [`Titular de la pieza (sin precio): ${titularVigente(src.revision?.titular)}`] : [])].join("\n")
        : [`Texto de la publicación: ${org!.fila.caption ?? ""}`].join("\n")
      let copy = await escribirAnuncio({ db, model: s.ai_model, brand, tipo: e.kind, pieza, destino: DESTINO[cta] ?? "mensaje" }).catch((err) => (log("ads:batch: la IA no escribió", { error: String(err) }), null))
      let probs = copy ? problemasCopy({ title: copy.titulo, body: copy.texto }, precios) : ["sin texto"]
      if (copy && probs.length) {
        copy = await escribirAnuncio({ db, model: s.ai_model, brand, tipo: e.kind, pieza, destino: DESTINO[cta] ?? "mensaje", pedido: `OJO, la versión anterior tenía estos problemas: ${probs.join("; ")}. Corregilos.` }).catch(() => null)
        probs = copy ? problemasCopy({ title: copy.titulo, body: copy.texto }, precios) : ["sin texto"]
      }
      if (!copy || probs.length) {
        log("ads:batch: el texto no pasó las reglas, se salta", { brand: b.slug, kind: e.kind, probs })
        continue
      }
      const preparar = e.kind === "reeditar" || e.kind === "organico" || !(src?.video_id || src?.image_hash)
      const fila = {
        brand_id: b.id,
        week,
        kind: e.kind,
        status: preparar ? "preparando" : "propuesta",
        source_ad_id: src?.id ?? null,
        source_media_id: org?.media_id ?? null,
        source_key: src ? `ad:${src.id}` : `media:${org!.media_id}`,
        ad_account_id: plantilla.ad_account_id,
        template_adset_id: plantilla.adset_id,
        title: copy.titulo.trim(),
        body: copy.texto.trim(),
        cta_type: cta,
        daily_budget: plantilla.daily_budget,
        por_que: porQue + notaPlantilla,
        numeros: {
          origen: src?.totals ?? null,
          habitual: ranking.habitual,
          apertura: copy.apertura,
          producto: copy.producto,
          lift: org?.lift ?? null,
          campaña: plantilla.campaign_name,
          conjunto: plantilla.adset_name,
          tasa_tipo: aprendido[e.kind].tasa,
          // El ganador estaba hecho con IA: sus «parecidas» publicadas probablemente también (aviso en rojo).
          origen_ia: !!src?.revision?.ia_generada,
        },
        pieces: preparar
          ? []
          : [{ formato: "original", tipo: src!.creative_kind === "video" ? "video" : "imagen", key: src!.thumb_key, meta_video_id: src!.video_id, meta_image_hash: src!.video_id ? null : src!.image_hash }],
      }
      const { data: ins, error } = await db.from("cos_ad_proposals").upsert(fila, { onConflict: "brand_id,week,kind,source_key", ignoreDuplicates: true }).select("id")
      if (error) throw new Error(`cos_ad_proposals: ${error.message}`)
      const id = ins?.[0]?.id as string | undefined
      if (id && preparar) await queue.enqueue("ads:piece", { proposal_id: id }, { dedupeKey: `ads:piece:${id}` })
      if (id) hechas++
    }
    await db.from("cos_audit_log").insert({ event: "ads:tanda", entity_type: "brand", entity_id: b.id, actor: "motor", details_json: { week, propuestas: hechas } })
    log("ads:batch tanda lista", { brand: b.slug, week, propuestas: hechas })
  }
}

// ── Piezas (re-edición / orgánico) ──────────────────────────────────────────

type Propuesta = {
  id: string
  brand_id: string
  week: string
  kind: TipoPropuesta
  status: string
  source_ad_id: string | null
  source_media_id: string | null
  ad_account_id: string
  template_adset_id: string
  title: string
  body: string
  cta_type: string | null
  daily_budget: number | null
  numeros: { apertura?: string } & Record<string, unknown>
  pieces: Pieza[]
  meta: MetaPasos
}
type Pieza = { formato: "9x16" | "4x5" | "original"; tipo: "video" | "imagen"; key: string | null; meta_video_id?: string | null; meta_image_hash?: string | null; video_listo?: boolean }
type MetaPasos = { adset_id?: string; adset_listo?: boolean; creatives?: Record<string, string>; ads?: Record<string, string>; esperas?: number }

async function propuesta(db: SupabaseClient, id: string): Promise<Propuesta> {
  return must(db.from("cos_ad_proposals").select("*").eq("id", id).single(), `propuesta ${id}`) as Promise<Propuesta>
}

/** El archivo original de una publicación de Instagram ya publicada (el link de Meta vence: se pide ahora). */
export async function bajarDeInstagram(db: SupabaseClient, mediaId: string): Promise<{ buf: Buffer; esVideo: boolean }> {
  const m = await must<{ remote_id: string; cos_social_accounts: { token_ref: string } | null }>(
    db.from("cos_media").select("remote_id, cos_social_accounts(token_ref)").eq("id", mediaId).single(),
    "publicación",
  )
  const token = tokenFor(m.cos_social_accounts?.token_ref ?? null)
  const r = await graph<{ media_type?: string; media_url?: string; children?: { data: { media_type: string; media_url: string }[] } }>("GET", m.remote_id, token, {
    fields: "media_type,media_url,children{media_type,media_url}",
  })
  const item = r.media_type === "CAROUSEL_ALBUM" ? r.children?.data?.[0] : r
  if (!item?.media_url) throw new PermanentError("Instagram no dio el archivo de la publicación")
  return { buf: await bajarUrl(item.media_url), esVideo: item.media_type === "VIDEO" }
}

const piece: Handler = async (job, { db, log }) => {
  const p = await propuesta(db, texto(job, "proposal_id"))
  if (p.status !== "preparando") return
  const st = supabaseStorage(db)
  const base = `ads/propuestas/${p.id}`
  try {
    let pieces: Pieza[]
    if (p.kind === "organico") {
      const { buf, esVideo } = await bajarDeInstagram(db, p.source_media_id!)
      pieces = await withTmp(async (dir) => {
        if (esVideo) {
          await st.upload(`${base}/original.mp4`, buf, "video/mp4")
          return [{ formato: "original" as const, tipo: "video" as const, key: `${base}/original.mp4` }]
        }
        const jpg = await fitForInstagramFeed(await writeTmp(dir, "img", buf), dir)
        await st.upload(`${base}/original.jpg`, jpg, "image/jpeg")
        return [{ formato: "original" as const, tipo: "imagen" as const, key: `${base}/original.jpg` }]
      })
    } else {
      let a = await anuncio(db, p.source_ad_id!)
      a = await asegurarMedios(db, a, true)
      if (p.kind !== "reeditar") {
        // Ganador sin archivo propio en Meta (publicación promocionada): se sube el video tal cual.
        if (!a.video_key && !a.thumb_key) throw new PermanentError("el anuncio de origen no tiene archivo")
        pieces = [{ formato: "original", tipo: a.video_key ? "video" : "imagen", key: a.video_key ?? a.thumb_key }]
      } else {
        const brand = await must<{ slug: string; datos_vigentes: unknown }>(db.from("cos_brands").select("slug, datos_vigentes").eq("id", p.brand_id).single(), "marca")
        const datos = normalizarDatos(brand.datos_vigentes)
        const textos = {
          tituloCierre: CIERRE_CTA[p.cta_type ?? ""] ?? "Pedí por mensaje",
          recuadro: "DELIVERY",
          pie: cierreDesdeDatos("", datos).pie,
        }
        const kit = await kitDeMarca(brand.slug, await loadKit(db, p.brand_id))
        if (!kit) throw new PermanentError(`la marca ${brand.slug} no tiene kit de diseño`)
        const { data: temas } = await db.from("cos_music_tracks").select("storage_key").eq("brand_id", p.brand_id).order("energy", { ascending: false, nullsFirst: false }).limit(1)
        // a) El video ganador tiene partes limpias: se usan esas, con otra apertura.
        const limpio = a.video_key ? guionReedicion(tramos(a), { ...textos, gancho: (p.numeros.apertura ?? "").slice(0, 40), idea: "re-edición del ganador" }) : null
        pieces = await withTmp(async (dir) => {
          let guion = limpio
          const archivos: { tipo: "foto" | "video"; archivo: string }[] = []
          if (limpio) archivos.push({ tipo: "video", archivo: await writeTmp(dir, "src.mp4", await st.download(a.video_key!)) })
          else {
            // b) El precio está pegado encima del producto en toda la pieza: se rearma el diseño
            //    (el titular ganador, sin precio) sobre fotos y videos REALES ya publicados.
            const titular = titularVigente(a.revision?.titular)
            if (!titular) throw new PermanentError("la pieza ganadora no tiene un titular que se pueda usar sin el precio")
            if (!a.thumb_key) throw new PermanentError("el ganador no tiene miniatura para comparar")
            const desde = new Date(Date.now() - 365 * 86_400_000).toISOString()
            const { data: cands } = await db
              .from("cos_media")
              .select("id, thumb_key, format")
              .eq("brand_id", p.brand_id)
              .eq("platform", "instagram")
              .in("format", ["feed", "reel", "carousel"])
              .not("thumb_key", "is", null)
              .gte("posted_at", desde)
              .order("metrics->reach", { ascending: false, nullsFirst: false })
              .limit(16)
            if (!cands?.length) throw new PermanentError("la marca no tiene publicaciones de Instagram con foto para rearmar")
            const thumbs = await Promise.all(cands.map((c) => st.download(c.thumb_key as string)))
            const s2 = await settings(db)
            const v = await elegirVisuales({ db, model: s2.ai_model, ganador: await st.download(a.thumb_key), producto: a.revision?.producto ?? "", candidatas: thumbs })
            if (!v.elegidas.length) throw new PermanentError(`no hay fotos reales publicadas del mismo producto (${v.motivo})`)
            for (const [i, idx] of v.elegidas.entries()) {
              const { buf, esVideo } = await bajarDeInstagram(db, cands[idx].id as string)
              archivos.push({ tipo: esVideo ? "video" : "foto", archivo: await writeTmp(dir, `f${i}${esVideo ? ".mp4" : ".jpg"}`, buf) })
            }
            const fuentes = await Promise.all(archivos.map(async (f) => ({ tipo: f.tipo, duracion: f.tipo === "video" ? ((await probe(f.archivo, "video/mp4")).durationMs ?? 3000) / 1000 : null })))
            guion = guionRearmado(fuentes, { ...textos, gancho: titular, idea: `rearmado del ganador sobre ${v.elegidas.length} publicaciones reales` })
            await db.from("cos_ad_proposals").update({ numeros: { ...p.numeros, visuales: v.elegidas.map((i) => cands[i].id), visuales_motivo: v.motivo, rearmado: true } }).eq("id", p.id)
          }
          if (!guion) throw new PermanentError("no queda material limpio suficiente para re-editar")
          const musica = temas?.[0] ? await writeTmp(dir, "musica", await st.download(temas[0].storage_key as string)) : null
          const r = await armarReel({ guion, gancho: guion.gancho, archivos, kit, musica, dir })
          await st.upload(`${base}/9x16.mp4`, await readFile(r.archivo), "video/mp4")
          // 4:5 para el feed: recorte del 9:16 apenas corrido hacia abajo (el texto va al 24 % del alto).
          const f45 = join(dir, "4x5.mp4")
          await run("ffmpeg", ["-loglevel", "error", "-y", "-i", r.archivo, "-vf", "crop=1080:1350:0:330", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "copy", "-movflags", "+faststart", f45], { timeout: 5 * 60_000 })
          await st.upload(`${base}/4x5.mp4`, await readFile(f45), "video/mp4")
          return [
            { formato: "9x16" as const, tipo: "video" as const, key: `${base}/9x16.mp4` },
            { formato: "4x5" as const, tipo: "video" as const, key: `${base}/4x5.mp4` },
          ]
        })
      }
    }
    await db.from("cos_ad_proposals").update({ pieces, status: "propuesta", error: null, updated_at: new Date().toISOString() }).eq("id", p.id)
    log("ads:piece lista", { propuesta: p.id, kind: p.kind, piezas: pieces.length })
  } catch (e) {
    if (e instanceof PermanentError || (e as { meta?: unknown }).meta) {
      await db.from("cos_ad_proposals").update({ status: "error", error: String((e as Error).message).slice(0, 400) }).eq("id", p.id)
      return
    }
    throw e
  }
}

// ── Crear en Meta, PAUSADO (E4) ─────────────────────────────────────────────

/**
 * La ÚNICA puerta de escritura a Meta del motor. Rechaza cualquier cosa que pudiera prender algo:
 * solo estos destinos, y `status` / `status_option` únicamente PAUSED.
 */
async function escribir<T>(path: string, token: string, params: Record<string, string>): Promise<T> {
  const permitido = /^act_\d+\/(advideos|adimages|adcreatives|ads)$|^\d+\/copies$|^\d+$/.test(path)
  if (!permitido) throw new PermanentError(`escritura no permitida: ${path}`)
  for (const k of ["status", "status_option", "configured_status"]) if (k in params && params[k] !== "PAUSED") throw new PermanentError(`el motor solo crea en PAUSA (${k}=${params[k]})`)
  if (/^\d+$/.test(path) && Object.keys(params).some((k) => !["name", "daily_budget", "status"].includes(k))) throw new PermanentError("solo se puede cambiar nombre, presupuesto o pausar")
  return graph<T>("POST", path, token, params)
}

const create: Handler = async (job, { db, queue, log }) => {
  const p = await propuesta(db, texto(job, "proposal_id"))
  if (!["aprobada", "creando"].includes(p.status)) return
  const acc = await cuenta(db, p.ad_account_id)
  const token = tokenFor(acc.token_ref)
  const meta: MetaPasos = { creatives: {}, ads: {}, ...p.meta }
  const pieces = [...p.pieces]
  const guardar = async (extra: Record<string, unknown> = {}) => {
    const { error } = await db.from("cos_ad_proposals").update({ meta, pieces, status: "creando", updated_at: new Date().toISOString(), ...extra }).eq("id", p.id)
    if (error) throw new Error(`propuesta: ${error.message}`)
  }
  // Paso hecho → se guarda y el siguiente va en otro trabajo, 10 s después.
  const seguir = async (paso: string, esperaMs = PAUSA_ESCRITURA_MS) => {
    await guardar()
    await queue.enqueue("ads:create", { proposal_id: p.id }, { runAt: new Date(Date.now() + esperaMs), dedupeKey: `ads:create:${p.id}:${paso}` })
  }

  try {
    const src = p.source_ad_id ? await anuncio(db, p.source_ad_id) : null
    const plantilla = src?.adset_id === p.template_adset_id ? src : ((await db.from("cos_ads").select("*").eq("adset_id", p.template_adset_id).limit(1).single()).data as AnuncioFila | null)
    if (!plantilla) throw new PermanentError("no encuentro el anuncio del conjunto que se copia")
    if (!plantilla.page_id) throw new PermanentError("el anuncio plantilla no tiene página")

    // 1) Archivos: se sube lo que no esté ya en la cuenta (de a uno).
    for (const pz of pieces) {
      if (pz.tipo === "video" && !pz.meta_video_id) {
        if (!pz.key) throw new PermanentError("la pieza no tiene archivo")
        const url = await supabaseStorage(db).signedUrl(pz.key, 3600)
        const r = await escribir<{ id: string }>(`${acc.id}/advideos`, token, { file_url: url, name: `MOTOR ${p.week} ${p.kind} ${pz.formato}` })
        pz.meta_video_id = r.id
        return seguir(`subir:${pz.formato}`)
      }
      if (pz.tipo === "imagen" && !pz.meta_image_hash) {
        if (!pz.key) throw new PermanentError("la pieza no tiene archivo")
        const bytes = (await supabaseStorage(db).download(pz.key)).toString("base64")
        const r = await escribir<{ images: Record<string, { hash: string }> }>(`${acc.id}/adimages`, token, { bytes })
        pz.meta_image_hash = Object.values(r.images)[0]?.hash
        if (!pz.meta_image_hash) throw new PermanentError("Meta no devolvió la imagen subida")
        return seguir(`subir:${pz.formato}`)
      }
      // Los videos recién subidos tardan en procesarse: se mira (lectura) cada 30 s.
      if (pz.tipo === "video" && pz.meta_video_id && !pz.video_listo) {
        const v = await graph<{ status?: { video_status?: string } }>("GET", pz.meta_video_id, token, { fields: "status" })
        const estado = v.status?.video_status
        if (estado === "ready") pz.video_listo = true
        else if (estado === "error") throw new PermanentError("Meta no pudo procesar el video")
        else {
          meta.esperas = (meta.esperas ?? 0) + 1
          if (meta.esperas > 40) throw new PermanentError("Meta tardó demasiado en procesar el video")
          return seguir(`esperar:${pz.formato}:${meta.esperas}`, 30_000)
        }
      }
    }

    // 2) Conjunto: copia del que mejor rindió (público, ubicaciones, optimización), PAUSADO.
    if (!meta.adset_id) {
      const r = await escribir<{ copied_adset_id: string }>(`${p.template_adset_id}/copies`, token, { deep_copy: "false", status_option: "PAUSED" })
      meta.adset_id = r.copied_adset_id
      return seguir("conjunto")
    }
    if (!meta.adset_listo) {
      // Por las dudas: si la copia no quedó en pausa, se pausa antes que nada.
      const a = await graph<{ effective_status?: string; status?: string; daily_budget?: string }>("GET", meta.adset_id, token, { fields: "status,effective_status,daily_budget" })
      const params: Record<string, string> = { name: `MOTOR · ${p.title.slice(0, 40)} · ${p.week}`, status: "PAUSED" }
      // El presupuesto solo si el conjunto lo tiene propio (en campañas con presupuesto de campaña, no).
      if (p.daily_budget && a.daily_budget && Number(a.daily_budget) > 0) params.daily_budget = aCentavos(Number(p.daily_budget))
      await escribir(meta.adset_id, token, params)
      meta.adset_listo = true
      return seguir("conjunto-nombre")
    }

    // 3) Un creativo y un anuncio por pieza (9:16 y 4:5 compiten en el mismo conjunto).
    const cta = { type: p.cta_type ?? plantilla.cta_type ?? "WHATSAPP_MESSAGE", value: plantilla.cta_value ?? { app_destination: "WHATSAPP" } }
    for (const pz of pieces) {
      if (!meta.creatives![pz.formato]) {
        let spec: Record<string, unknown>
        if (pz.tipo === "video") {
          const th = await graph<{ data: { uri: string; is_preferred?: boolean }[] }>("GET", `${pz.meta_video_id}/thumbnails`, token, {})
          const tapa = th.data.find((t) => t.is_preferred)?.uri ?? th.data[0]?.uri
          if (!tapa) throw new Error("el video todavía no tiene tapa")
          spec = { video_id: pz.meta_video_id, image_url: tapa, title: p.title, message: p.body, call_to_action: cta }
          spec = { page_id: plantilla.page_id, ...(plantilla.ig_user_id ? { instagram_user_id: plantilla.ig_user_id } : {}), video_data: spec }
        } else {
          const link = (plantilla.cta_value as { link?: string } | null)?.link ?? "https://api.whatsapp.com/send"
          spec = { page_id: plantilla.page_id, ...(plantilla.ig_user_id ? { instagram_user_id: plantilla.ig_user_id } : {}), link_data: { image_hash: pz.meta_image_hash, name: p.title, message: p.body, link, call_to_action: cta } }
        }
        const r = await escribir<{ id: string }>(`${acc.id}/adcreatives`, token, { name: `MOTOR ${p.week} ${p.kind} ${pz.formato}`, object_story_spec: JSON.stringify(spec) })
        meta.creatives![pz.formato] = r.id
        return seguir(`creativo:${pz.formato}`)
      }
      if (!meta.ads![pz.formato]) {
        const r = await escribir<{ id: string }>(`${acc.id}/ads`, token, {
          name: `MOTOR · ${p.title.slice(0, 40)} · ${pz.formato}`,
          adset_id: meta.adset_id,
          creative: JSON.stringify({ creative_id: meta.creatives![pz.formato] }),
          status: "PAUSED",
        })
        meta.ads![pz.formato] = r.id
        // El sync lo completa después; el vínculo con la propuesta queda desde ya (E5).
        await db.from("cos_ads").upsert({ id: r.id, ad_account_id: acc.id, brand_id: p.brand_id, page_id: plantilla.page_id, name: `MOTOR · ${p.title.slice(0, 40)} · ${pz.formato}`, status: "PAUSED", adset_id: meta.adset_id, proposal_id: p.id }, { onConflict: "id" })
        return seguir(`anuncio:${pz.formato}`)
      }
    }

    // 4) Listo.
    await guardar({ status: "creada", created_in_meta_at: new Date().toISOString(), error: null })
    await db.from("cos_audit_log").insert({ event: "ads:creada", entity_type: "ad_proposal", entity_id: p.id, actor: "motor", details_json: { adset_id: meta.adset_id, ads: meta.ads } })
    const { count } = await db.from("cos_ad_proposals").select("id", { count: "exact", head: true }).eq("brand_id", p.brand_id).eq("week", p.week).in("status", ["aprobada", "creando"])
    if (!count) {
      await db.from("cos_audit_log").insert({ event: "ads:tanda_en_meta", entity_type: "brand", entity_id: p.brand_id, actor: "motor", details_json: { week: p.week, mensaje: "Tanda lista en Meta, pausada" } })
      // F11 V3: la tanda entera ya está en Meta → se arma su vitrina (Javier la aprueba antes de avisar al equipo).
      const { data: marca } = await db.from("cos_brands").select("name").eq("id", p.brand_id).single()
      const titulo = `${marca?.name ?? "Anuncios"} · semana del ${p.week.split("-").reverse().slice(0, 2).join("/")}`
      const { data: vit } = await db
        .from("cos_vitrinas")
        .insert({ brand_id: p.brand_id, slug: slugVitrina(titulo), titulo, bajada: "Los anuncios nuevos de la semana.", origen: "motor", proposal_week: p.week })
        .select("id")
        .single()
      if (vit) await queue.enqueue("vitrina:build", { vitrina_id: vit.id }, { dedupeKey: `vitrina:build:${vit.id}` })
    }
    log("ads:create listo (PAUSADO)", { propuesta: p.id, adset: meta.adset_id, ads: meta.ads })
  } catch (e) {
    if (e instanceof PermanentError || (e as { meta?: unknown }).meta) {
      await guardar({ status: "error", error: String((e as Error).message).slice(0, 400) })
      return
    }
    throw e
  }
}

export const adsHandlers: Record<string, Handler> = {
  "ads:sync": sync,
  "ads:media": media,
  "ads:review": review,
  "ads:batch": batch,
  "ads:piece": piece,
  "ads:create": create,
}

/** Para el reloj del worker: el motor corre solo si está el token de anuncios. */
export function adsConfig(): boolean {
  return !!process.env.META_ADS_TOKEN
}

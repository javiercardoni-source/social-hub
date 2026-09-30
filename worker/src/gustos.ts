/**
 * F7 Motor de gustos · M0 — fichas de música y rasgos de imagen.
 *
 *   music:sync       la biblioteca (cos-media/music/<marca>/) ↔ cos_music_tracks. Idempotente.
 *   music:analyze    ficha automática de un tema: duración, BPM y energía (ffmpeg + análisis puro)
 *   traits:backfill  rasgos visuales de lo que ya existe (assets y todo lo publicado), por tandas,
 *                    reanudable y con tope de gasto. NO se dispara solo: lo encola una persona.
 *
 * La elección de música sigue al azar en M0: acá solo se registra y se mide.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { PermanentError, type Job } from "./queue.ts"
import type { Handler } from "./handlers.ts"
import { MEDIA_BUCKET, storageFor, supabaseStorage } from "./storage.ts"
import { audioSeconds, decodeAudio, framesForAi, probe, sceneCuts, withTmp, writeTmp } from "./media.ts"
import { classifyTraits } from "./ai.ts"
import { freshThumbUrl, saveThumb } from "./metrics.ts"
import { MetaError, isTokenError, tokenFor } from "./meta.ts"
import { TRAITS_VERSION, analizarAudio, esRutaDeMusica, normalizarRasgos, ritmoDeCortes, tandaDentroDelTope, tituloTema } from "../../shared/cos/gustos.ts"

const AUDIO_RE = /\.(mp3|m4a|wav|aac)$/i

// ── music:sync ─────────────────────────────────────────────────────────────

/** Deja cos_music_tracks igual que el bucket: altas, bajas (active = false, nunca se borra) y reactivaciones. */
export async function syncMusicLibrary(db: SupabaseClient): Promise<{ altas: number; bajas: number; reactivados: number; aAnalizar: string[] }> {
  const { data: marcas, error } = await db.from("cos_brands").select("id, slug").eq("active", true)
  if (error) throw new Error(`marcas: ${error.message}`)
  let altas = 0
  let bajas = 0
  let reactivados = 0
  for (const b of marcas ?? []) {
    const { data: files, error: le } = await db.storage.from(MEDIA_BUCKET).list(`music/${b.slug}`, { limit: 1000 })
    if (le) throw new Error(`biblioteca de ${b.slug}: ${le.message}`)
    const enBucket = new Set((files ?? []).filter((f) => AUDIO_RE.test(f.name)).map((f) => `music/${b.slug}/${f.name}`))
    const { data: filas, error: te } = await db.from("cos_music_tracks").select("id, storage_key, active").eq("brand_id", b.id)
    if (te) throw new Error(`cos_music_tracks: ${te.message}`)
    const conocidas = new Map((filas ?? []).map((t) => [t.storage_key as string, t]))

    const nuevas = [...enBucket].filter((k) => !conocidas.has(k) && esRutaDeMusica(k, b.slug))
    if (nuevas.length) {
      const { data: ins, error: ie } = await db
        .from("cos_music_tracks")
        .upsert(nuevas.map((k) => ({ brand_id: b.id, storage_key: k, title: tituloTema(k) })), { onConflict: "storage_key", ignoreDuplicates: true })
        .select("id")
      if (ie) throw new Error(`alta de temas: ${ie.message}`)
      altas += ins?.length ?? 0
    }
    const volver = (filas ?? []).filter((t) => !t.active && enBucket.has(t.storage_key)).map((t) => t.id)
    if (volver.length) {
      await db.from("cos_music_tracks").update({ active: true }).in("id", volver)
      reactivados += volver.length
    }
    const faltan = (filas ?? []).filter((t) => t.active && !enBucket.has(t.storage_key)).map((t) => t.id)
    if (faltan.length) {
      await db.from("cos_music_tracks").update({ active: false }).in("id", faltan)
      bajas += faltan.length
    }
  }
  const { data: pend } = await db.from("cos_music_tracks").select("id").eq("active", true).is("analyzed_at", null).is("analysis_error", null).limit(200)
  return { altas, bajas, reactivados, aAnalizar: (pend ?? []).map((p) => p.id as string) }
}

const syncMusic: Handler = async (_job, { db, queue, log }) => {
  const r = await syncMusicLibrary(db)
  for (const id of r.aAnalizar) await queue.enqueue("music:analyze", { track_id: id }, { dedupeKey: `music:analyze:${id}` })
  log("biblioteca de música sincronizada", { altas: r.altas, bajas: r.bajas, reactivados: r.reactivados, aAnalizar: r.aAnalizar.length })
}

// ── music:analyze ──────────────────────────────────────────────────────────

function uuidFrom(job: Job, key: string): string {
  const v = job.payload[key]
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/.test(v)) throw new PermanentError(`payload sin ${key} válido`)
  return v
}

const analyzeMusic: Handler = async (job, { db, log }) => {
  const id = uuidFrom(job, "track_id")
  const { data: t, error } = await db.from("cos_music_tracks").select("id, storage_key, active").eq("id", id).maybeSingle()
  if (error) throw new Error(`cos_music_tracks: ${error.message}`)
  if (!t) throw new PermanentError(`el tema ${id} no existe`)
  let audio: Buffer
  try {
    audio = await supabaseStorage(db).download(t.storage_key)
  } catch (e) {
    // El archivo ya no está: el tema sale de la biblioteca (la próxima sincronización lo confirma).
    await db.from("cos_music_tracks").update({ analysis_error: `no se pudo bajar: ${String(e).slice(0, 300)}` }).eq("id", id)
    throw new PermanentError(`no se pudo bajar ${t.storage_key}`)
  }
  let r: { dur: number } & ReturnType<typeof analizarAudio>
  try {
    r = await withTmp(async (dir) => {
      const file = await writeTmp(dir, `tema${t.storage_key.match(AUDIO_RE)?.[0] ?? ".mp3"}`, audio)
      const [dur, samples] = await Promise.all([audioSeconds(file), decodeAudio(file)])
      return { dur, ...analizarAudio(samples, 11025) }
    })
  } catch (e) {
    // El mismo archivo no se arregla reintentando: se anota (la pantalla deja de decir "midiendo").
    await db.from("cos_music_tracks").update({ analysis_error: `no se pudo medir: ${String(e).slice(0, 300)}` }).eq("id", id)
    throw new PermanentError(`no se pudo medir ${t.storage_key}: ${String(e).slice(0, 200)}`)
  }
  await db
    .from("cos_music_tracks")
    .update({
      duration_s: Number.isFinite(r.dur) ? Math.round(r.dur * 10) / 10 : null,
      bpm: r.bpm,
      bpm_confidence: r.bpmConfianza,
      energy: r.energy,
      analyzed_at: new Date().toISOString(),
      analysis_error: null,
    })
    .eq("id", id)
  log("ficha de tema", { track: id, key: t.storage_key, dur: r.dur, bpm: r.bpm, confianza: r.bpmConfianza, energy: r.energy, rmsDb: r.rmsDb })
}

// ── traits:backfill ────────────────────────────────────────────────────────

/** Estimación conservadora por elemento (Haiku, 1 imagen ≈ USD 0,002; video con 4 cuadros más). */
export const TRAITS_USD_POR_ITEM = 0.004
const TANDA = 25
/** Llamadas a Meta por tanda (miniaturas que faltan): comparte límite con la medición de métricas. */
const MAX_META_POR_TANDA = 10
const PAUSA_LIMITE_META_MS = 30 * 60_000

/** Lo gastado en backfill de rasgos hasta ahora (paginado: pueden ser miles de filas). */
async function gastadoEnRasgos(db: SupabaseClient): Promise<number> {
  let total = 0
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("cos_ai_usage").select("cost_usd").eq("purpose", "traits:backfill").range(from, from + 999)
    if (error) throw new Error(`cos_ai_usage: ${error.message}`)
    for (const r of data ?? []) total += Number(r.cost_usd ?? 0)
    if (!data || data.length < 1000) break
  }
  return total
}

// Pendiente = sin rasgos de la versión actual y sin un error ya anotado (lo que falló no se reintenta solo).
const pendienteAssets = (db: SupabaseClient) =>
  db
    .from("cos_assets")
    .select("id, brand_id, media_type, mime, storage_driver, storage_key", { count: "exact" })
    .or(`traits_version.is.null,traits_version.lt.${TRAITS_VERSION}`)
    .is("traits_error", null)
    .not("storage_key", "is", null)
    .not("media_type", "is", null)
    .neq("source", "sistema")
    .in("status", ["READY", "IN_USE", "ARCHIVED"])

const pendienteMedia = (db: SupabaseClient) =>
  db
    .from("cos_media")
    .select("id, platform, remote_id, thumb_key, cos_social_accounts(token_ref)", { count: "exact" })
    .or(`traits_version.is.null,traits_version.lt.${TRAITS_VERSION}`)
    .is("traits_error", null)
    // Las historias viejas ya no existen en Meta y las nuevas se miden por otras vías.
    .neq("format", "story")

export async function contarPendientesRasgos(db: SupabaseClient) {
  const [a, m] = await Promise.all([pendienteAssets(db).limit(1), pendienteMedia(db).limit(1)])
  if (a.error) throw new Error(`cos_assets: ${a.error.message}`)
  if (m.error) throw new Error(`cos_media: ${m.error.message}`)
  return { assets: a.count ?? 0, media: m.count ?? 0 }
}

type AssetPend = { id: string; brand_id: string; media_type: "photo" | "video"; mime: string | null; storage_driver: string | null; storage_key: string }
type MediaPend = { id: string; platform: string; remote_id: string; thumb_key: string | null; cos_social_accounts: { token_ref: string | null } | null }

async function rasgosDeAsset(db: SupabaseClient, model: string, a: AssetPend) {
  const original = await storageFor(a.storage_driver, db).download(a.storage_key)
  const { frames, ritmo, dur } = await withTmp(async (dir) => {
    const file = await writeTmp(dir, "original", original)
    const info = await probe(file, a.mime)
    const frames = await framesForAi(file, info, dir)
    if (info.mediaType !== "video" || !info.durationMs) return { frames, ritmo: null, dur: null }
    const dur = info.durationMs / 1000
    return { frames, ritmo: ritmoDeCortes(await sceneCuts(file), dur), dur }
  })
  const { rasgos, costUsd } = await classifyTraits({ db, model, frames, mediaType: a.media_type, assetId: a.id })
  await db
    .from("cos_assets")
    .update({ traits: normalizarRasgos({ ...rasgos, ritmo, duracion_s: dur }), traits_version: TRAITS_VERSION, traits_error: null })
    .eq("id", a.id)
  return costUsd
}

async function rasgosDeMedia(db: SupabaseClient, model: string, m: MediaPend, puedeLlamarMeta: () => boolean) {
  let key = m.thumb_key
  if (!key) {
    if (!puedeLlamarMeta()) return null // queda para la próxima tanda
    // Sin miniatura propia: se pide a Meta una URL fresca (solo lectura) y se guarda.
    const url = await freshThumbUrl(m.platform, m.remote_id, tokenFor(m.cos_social_accounts?.token_ref ?? null))
    if (!url) throw new Error("Meta no devuelve imagen para esta publicación")
    key = `analytics/${m.platform}/${m.remote_id}.jpg`
    await saveThumb(db, key, url)
    await db.from("cos_media").update({ thumb_key: key }).eq("id", m.id)
  }
  const jpg = await supabaseStorage(db).download(key)
  const { rasgos, costUsd } = await classifyTraits({ db, model, frames: [jpg], mediaType: "photo" })
  // De lo publicado solo hay una imagen: sin ritmo ni duración (se miden en lo que tenemos en video).
  await db
    .from("cos_media")
    .update({ traits: normalizarRasgos({ ...rasgos, ritmo: null, duracion_s: null }), traits_version: TRAITS_VERSION, traits_error: null })
    .eq("id", m.id)
  return costUsd
}

/**
 * Qué hacer con un error de un elemento:
 *   token   → frena todo (PermanentError: hay que reconectar la cuenta)
 *   limite  → Meta pide esperar: la cadena se pausa y sigue más tarde
 *   elemento → problema de ESE post o archivo (borrado en Meta, imagen ilegible): se anota y se sigue
 *   otro    → IA caída, red: se reintenta el trabajo entero (lo ya hecho no se repite)
 */
export function clasificarError(e: unknown): "token" | "limite" | "elemento" | "otro" {
  if (isTokenError(e)) return "token"
  if (e instanceof MetaError) return "limite" // graphGet solo deja pasar como MetaError lo transitorio
  // Error permanente de Meta sobre esta publicación (graphGet lo envuelve en PermanentError con .meta).
  if (e instanceof PermanentError && (e as { meta?: unknown }).meta) return "elemento"
  const msg = String(e instanceof Error ? e.message : e)
  return /miniatura \d|no pude bajar|no devuelve imagen|legible|Invalid data found/i.test(msg) ? "elemento" : "otro"
}

const backfillTraits: Handler = async (job, { db, queue, log, signal }) => {
  // Una sola corrida a la vez (la continuación y un encolado a mano pueden coincidir).
  const { data: running } = await db.from("cos_jobs").select("id").eq("type", "traits:backfill").eq("status", "running").neq("id", job.id).limit(1)
  if (running?.length) return log("ya hay un backfill de rasgos en curso: este se saltea")

  const { data: s, error: se } = await db.from("cos_settings").select("ai_model_light, traits_backfill_max_usd").eq("id", true).single()
  if (se || !s) throw new Error(`configuración: ${se?.message}`)
  // El tope lo manda la configuración; el encargo solo lo puede bajar.
  const pedido = Number(job.payload.max_usd)
  const tope = Math.min(Number(s.traits_backfill_max_usd), Number.isFinite(pedido) && pedido >= 0 ? pedido : Infinity)
  const tanda = Math.max(1, Math.min(100, Number(job.payload.tanda) || TANDA))

  const gastado = await gastadoEnRasgos(db)
  const pend = await contarPendientesRasgos(db)
  const pendientes = pend.assets + pend.media
  const estimado = Math.round(pendientes * TRAITS_USD_POR_ITEM * 100) / 100
  if (job.payload.dry_run === true) {
    return log("backfill de rasgos (simulacro, no llama a la IA)", { ...pend, gastado, tope, estimadoUsd: estimado })
  }
  const n = tandaDentroDelTope({ pendientes, gastadoUsd: gastado, topeUsd: tope, porItemUsd: TRAITS_USD_POR_ITEM, tanda })
  if (!n) {
    return log(pendientes ? "backfill de rasgos frenado: llegó al tope de gasto" : "backfill de rasgos terminado", { ...pend, gastado, tope })
  }

  let hechos = 0
  let fallidos = 0
  let costo = 0
  // Primero los assets (lo que se va a publicar), después lo publicado.
  const { data: assets, error: ae } = await pendienteAssets(db).order("created_at", { ascending: false }).limit(n)
  if (ae) throw new Error(`cos_assets: ${ae.message}`)
  const resto = n - (assets?.length ?? 0)
  // Lo que ya tiene miniatura primero: no gasta llamadas a Meta.
  const { data: media, error: me } =
    resto > 0
      ? await pendienteMedia(db).order("thumb_key", { ascending: true, nullsFirst: false }).order("posted_at", { ascending: false }).limit(resto)
      : { data: [], error: null }
  if (me) throw new Error(`cos_media: ${me.message}`)

  const items: (["asset", AssetPend] | ["media", MediaPend])[] = [
    ...((assets ?? []) as AssetPend[]).map((a) => ["asset", a] as ["asset", AssetPend]),
    ...((media ?? []) as unknown as MediaPend[]).map((m) => ["media", m] as ["media", MediaPend]),
  ]
  let llamadasMeta = 0
  let esperarMeta = false
  const puedeLlamarMeta = () => llamadasMeta++ < MAX_META_POR_TANDA
  for (const [tipo, it] of items) {
    if (signal.aborted) break
    // Tope estricto con el gasto REAL: si el próximo (a lo estimado) lo pasaría, se corta acá.
    if (gastado + costo + TRAITS_USD_POR_ITEM > tope) break
    try {
      const c = tipo === "asset" ? await rasgosDeAsset(db, s.ai_model_light, it as AssetPend) : await rasgosDeMedia(db, s.ai_model_light, it as MediaPend, puedeLlamarMeta)
      if (c == null) continue
      costo += c
      hechos++
    } catch (e) {
      const clase = clasificarError(e)
      if (clase === "limite") {
        esperarMeta = true
        log("Meta pidió esperar: el backfill sigue en 30 min", { error: String(e) })
        break
      }
      if (clase !== "elemento") throw e
      fallidos++
      await db
        .from(tipo === "asset" ? "cos_assets" : "cos_media")
        .update({ traits_error: String(e instanceof Error ? e.message : e).slice(0, 500) })
        .eq("id", it.id)
    }
  }
  log("backfill de rasgos: tanda", { hechos, fallidos, costoUsd: Math.round(costo * 1000) / 1000, gastado: Math.round((gastado + costo) * 100) / 100, tope })

  // Queda trabajo y plata: sigue en un rato (clave propia por eslabón de la cadena). También si el
  // worker se está apagando (un deploy): si no, la cadena terminaba "hecha" y el backfill se frenaba solo.
  if (pendientes - hechos - fallidos > 0 && gastado + costo < tope) {
    // Si esta tanda llamó a Meta, la próxima va más espaciada (60 s) para no pisar la medición de métricas.
    const espera = esperarMeta ? PAUSA_LIMITE_META_MS : llamadasMeta > 0 ? 60_000 : 20_000
    await queue.enqueue("traits:backfill", { ...job.payload }, { runAt: new Date(Date.now() + espera), dedupeKey: `traits:backfill:after:${job.id}` })
  }
}

export const gustosHandlers: Record<string, Handler> = {
  "music:sync": syncMusic,
  "music:analyze": analyzeMusic,
  "traits:backfill": backfillTraits,
}

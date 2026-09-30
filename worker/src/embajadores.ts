/**
 * F4B — Material del Programa Embajadores (LoyalEngine), docs/embajadores/CONTRATO-CONTENT-OS.md.
 * Copia el patrón de turnos.ts: Content OS consulta (pull), LoyalEngine nunca llama acá.
 * Apagado si faltan LOYAL_API_URL / CONTENT_OS_SECRET_LOYAL.
 *
 * Frontera con LoyalEngine (sin claves cruzadas): el vínculo es
 * `cos_assets.source = 'embajadores'` + `source_external_id = 'amb:<submission_id>'`.
 * El `brand_slug` que manda LoyalEngine ES el slug de la marca acá (ej: "fasutofudo").
 *
 * Cada ciclo (cada 3 min, ver main.ts) hace dos cosas:
 *   1. Trae lo pendiente, lo sube y pide asset:process (y el ack a LoyalEngine).
 *   2. Barre lo que ya se clasificó y todavía no se le avisó el puntaje a LoyalEngine
 *      (por si el aviso anterior falló): así el reintento no depende de un job aparte.
 *
 * Videos pesados (verificado a mano el 30-09: el proyecto de Supabase corta TODO objeto
 * en 50 MB, aunque el bucket admita más — un PUT de 60 MB dio 413). Los celulares mandan
 * videos de hasta 600 MB, así que arriba de TRANSCODE_ABOVE_BYTES (o video sin tamaño
 * declarado) se baja a disco (nunca a memoria) y se comprime con ffmpeg antes de subir.
 */
import { execFile } from "node:child_process"
import { createReadStream, createWriteStream } from "node:fs"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as WebReadableStream } from "node:stream/web"
import { promisify } from "node:util"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Queue } from "./queue.ts"
import { probe, withTmp } from "./media.ts"
import { supabaseStorage } from "./storage.ts"

type Item = {
  id: string
  kind: "video" | "foto"
  brand_slug: string
  submitted_by: string | null
  description: string | null
  mime: string
  size_bytes: number | null
  created_at: string
  download_url: string
  image_rights_ok: boolean
}

export function embajadoresConfig() {
  const url = process.env.LOYAL_API_URL
  const secret = process.env.CONTENT_OS_SECRET_LOYAL
  return url && secret ? { url: url.replace(/\/$/, ""), secret } : null
}

const EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
}

type Cfg = { url: string; secret: string }

// ── Videos pesados: bajar a disco, comprimir, subir en streaming ───────────

// El proyecto (no el bucket) corta en 50 MB: se transcodifica arriba de esto, con margen.
const TRANSCODE_ABOVE_BYTES = 45 * 1024 * 1024
const TARGET_MAX_BYTES = 44 * 1024 * 1024
// Si ni comprimido a 720p entra, o el archivo está roto, no tiene sentido reintentar
// cada 3 minutos para siempre: después de esto se loguea y se deja de intentar.
const MAX_INTENTOS_TRANSCODE = 3
// En memoria (no en la base): alcanza para cortar el loop caliente mientras el worker
// vive, y no hace falta una columna solo para esto (ver CONTRATO-CONTENT-OS.md §Content OS).
const intentosTranscode = new Map<string, number>()

const run = promisify(execFile)
const FF_TIMEOUT_MS = 15 * 60_000 // un video de 600 MB con 2 hilos puede tardar
async function ffmpeg(args: string[]) {
  await run("ffmpeg", ["-y", "-loglevel", "error", ...args], { timeout: FF_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 })
}

/** Baja el archivo directo a disco (nunca a memoria): pipeline de streams, no arrayBuffer(). */
async function descargarAArchivo(url: string, destino: string) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`descarga: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), createWriteStream(destino))
}

/**
 * Bitrate de video (kbps) para que, sumado a `audioKbps` de audio, el total entre en
 * `targetBytes` a lo largo de `durationMs`. Margen del 10 % para el contenedor y los picos
 * (los amortiguan maxrate/bufsize en el llamado a ffmpeg). Nunca menos de 300 kbps.
 * Aparte para poder probar la cuenta sola, sin correr ffmpeg de verdad.
 */
export function calcularBitrateObjetivo(durationMs: number | null, targetBytes: number, audioKbps: number): number {
  const segundos = Math.max(1, (durationMs ?? 0) / 1000)
  return Math.max(300, Math.floor(((targetBytes * 8) / segundos / 1000) * 0.9) - audioKbps)
}

/**
 * H.264/AAC MP4, máximo 1080 en el lado largo (mantiene orientación: ffmpeg re-codifica
 * respetando la rotación del original, no hace falta tocar nada aparte), CRF 23, veryfast,
 * hilos acotados (como reel.ts: el worker murió por memoria en 768 MB, está en 1,5 GB).
 * Si igual no entra, un segundo intento a 720p con el bitrate que da la duración del video.
 */
async function transcodificar(dir: string, original: string, durationMs: number | null): Promise<string> {
  const pase1 = join(dir, "720-1080p.mp4")
  await ffmpeg([
    "-i", original,
    "-vf", "scale='if(gt(iw,ih),min(1080,iw),-2)':'if(gt(iw,ih),-2,min(1080,ih))'",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-threads", "2",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
    pase1,
  ])
  if ((await stat(pase1)).size <= TARGET_MAX_BYTES) return pase1

  const audioKbps = 96
  const videoKbps = calcularBitrateObjetivo(durationMs, TARGET_MAX_BYTES, audioKbps)
  const pase2 = join(dir, "720p-bitrate.mp4")
  await ffmpeg([
    "-i", original,
    "-vf", "scale='if(gt(iw,ih),min(720,iw),-2)':'if(gt(iw,ih),-2,min(720,ih))'",
    "-c:v", "libx264", "-preset", "veryfast", "-threads", "2",
    "-b:v", `${videoKbps}k`, "-maxrate", `${Math.round(videoKbps * 1.3)}k`, "-bufsize", `${videoKbps * 2}k`,
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", `${audioKbps}k`, "-movflags", "+faststart",
    pase2,
  ])
  return pase2
}

/** Baja (a disco), comprime y sube en streaming; devuelve la clave y el tamaño final. */
async function subirVideoPesado(db: SupabaseClient, brand: { slug: string }, it: Item) {
  return withTmp(async (dir) => {
    const original = join(dir, `original.${EXT[it.mime] ?? "bin"}`)
    await descargarAArchivo(it.download_url, original)
    // De paso valida que el archivo se pueda leer (si ffprobe no le encuentra video, está roto).
    const info = await probe(original, it.mime)
    const comprimido = await transcodificar(dir, original, info.durationMs)
    const tamaño = (await stat(comprimido)).size
    if (tamaño > TARGET_MAX_BYTES) throw new Error(`sigue pesando ${tamaño} bytes ni comprimido a 720p`)
    const key = `originals/${brand.slug}/embajadores/${it.id}.mp4`
    // Desde disco en streaming, no un Buffer entero: el archivo comprimido puede seguir
    // pesando varias decenas de MB.
    await supabaseStorage(db).upload(key, createReadStream(comprimido), "video/mp4")
    return { key, mime: "video/mp4", sizeBytes: tamaño }
  })
}

/** Inserta el cos_assets ya con el archivo subido (source_key/mime/tamaño según el camino usado). */
async function crearAsset(db: SupabaseClient, brand: { id: string }, it: Item, externalId: string, archivo: { key: string; mime: string; sizeBytes: number | null }) {
  const descripcion = (it.description ?? "").trim()
  const ins = await db
    .from("cos_assets")
    .insert({
      brand_id: brand.id,
      source: "embajadores",
      source_external_id: externalId,
      description: descripcion.length >= 15 ? descripcion.slice(0, 500) : `Material de ${it.submitted_by ?? "un embajador"} (Programa Embajadores)`,
      submitted_by_label: it.submitted_by,
      mime: archivo.mime,
      size_bytes: archivo.sizeBytes,
      storage_driver: "supabase",
      storage_key: archivo.key,
      status: "NEW",
      // Ya pasó por las bases (image_rights_ok) y Javier lo aprobó en LoyalEngine: no hace
      // falta que alguien vuelva a tocar "Tengo permiso, usar" acá.
      consent: "ok",
      // Pre-aprobado (como turnos/manual): arma el borrador solo y, a la vez, entra al
      // Archivo con el filtro "Embajadores" (estado "Elegidos"), no a "De la cocina".
      review_status: "approved",
    })
    .select("id")
    .single()
  if (ins.error || !ins.data) throw new Error(`asset del embajador ${it.id}: ${ins.error?.message}`)
  return ins.data as { id: string }
}

/** 1) Pending → asset en Content OS → asset:process → ack. */
async function ingestPending(db: SupabaseClient, queue: Queue, cfg: Cfg, log: (m: string, x?: Record<string, unknown>) => void) {
  const res = await fetch(`${cfg.url}/api/integrations/content/pending?limit=20`, { headers: { "x-content-os-secret": cfg.secret } })
  if (!res.ok) throw new Error(`LoyalEngine pending: HTTP ${res.status}`)
  const { items } = (await res.json()) as { items: Item[] }
  let tomadas = 0
  for (const it of items) {
    const externalId = `amb:${it.id}`
    const { data: brand } = await db.from("cos_brands").select("id, slug").eq("slug", it.brand_slug).eq("active", true).maybeSingle()
    if (!brand) {
      log("embajador con una marca que Content OS no maneja (se saltea; queda sin ack)", { embajador: it.id, brand: it.brand_slug })
      continue
    }

    // Idempotencia: si ya se tomó (y se cortó antes del ack), se reusa el asset por la clave única.
    let { data: asset } = await db.from("cos_assets").select("id").eq("source", "embajadores").eq("source_external_id", externalId).maybeSingle()
    if (!asset) {
      // Solo importa para video: las fotos vienen de un link firmado de Supabase (ya viven ahí,
      // así que ya entran en el límite del proyecto) y no tiene sentido pasarlas por ffmpeg.
      const pesado = it.kind === "video" && (it.size_bytes == null || it.size_bytes > TRANSCODE_ABOVE_BYTES)
      if (pesado) {
        const intentos = intentosTranscode.get(it.id) ?? 0
        if (intentos >= MAX_INTENTOS_TRANSCODE) {
          log("embajador con un video que no entra ni comprimido después de varios intentos (revisar a mano; se saltea)", { embajador: it.id, intentos })
          continue
        }
        try {
          const subido = await subirVideoPesado(db, brand, it)
          asset = await crearAsset(db, brand, it, externalId, subido)
          intentosTranscode.delete(it.id)
          log("video pesado de embajador comprimido y subido", { embajador: it.id, asset: asset.id, original_bytes: it.size_bytes, final_bytes: subido.sizeBytes })
        } catch (e) {
          intentosTranscode.set(it.id, intentos + 1)
          log("no se pudo bajar/comprimir el video del embajador (se reintenta el próximo ciclo)", { embajador: it.id, intento: intentos + 1, error: String(e).slice(0, 300) })
          continue
        }
      } else {
        const file = await fetch(it.download_url)
        if (!file.ok || !file.body) throw new Error(`descarga del material de embajador ${it.id}: HTTP ${file.status}`)
        const key = `originals/${brand.slug}/embajadores/${it.id}.${EXT[it.mime] ?? "bin"}`
        // Streaming directo de la descarga a cos-media: no se junta en memoria.
        await supabaseStorage(db).upload(key, file.body, it.mime)
        asset = await crearAsset(db, brand, it, externalId, { key, mime: it.mime, sizeBytes: it.size_bytes })
      }
      await queue.enqueue("asset:process", { asset_id: asset.id }, { dedupeKey: `process:${asset.id}` })
    }

    const ack = await fetch(`${cfg.url}/api/integrations/content/ack`, {
      method: "POST",
      headers: { "x-content-os-secret": cfg.secret, "content-type": "application/json" },
      body: JSON.stringify({ id: it.id, cos_asset_id: asset.id }),
    })
    if (ack.status === 409) {
      // Alguien (otro ciclo, otro worker) ya lo ackeó con OTRO asset: no tiene sentido
      // reintentar esto de nuevo, queda solo la alerta.
      log("embajador ya estaba ackeado en LoyalEngine con otro asset (revisar a mano)", { embajador: it.id, asset: asset.id })
      continue
    }
    if (!ack.ok) throw new Error(`ack del embajador ${it.id}: HTTP ${ack.status}`)
    tomadas++
    log("material de embajador tomado", { embajador: it.id, asset: asset.id, brand: brand.slug })
  }
  return tomadas
}

/** 2) Lo ya clasificado (tiene quality_score) que todavía no se le avisó a LoyalEngine. */
async function sweepScores(db: SupabaseClient, cfg: Cfg, log: (m: string, x?: Record<string, unknown>) => void) {
  const { data: rows } = await db
    .from("cos_assets")
    .select("id, source_external_id, quality_score")
    .eq("source", "embajadores")
    .not("quality_score", "is", null)
    .is("embajador_scored_at", null)
  let puntuadas = 0
  for (const row of (rows ?? []) as { id: string; source_external_id: string | null; quality_score: number }[]) {
    const submissionId = row.source_external_id?.replace(/^amb:/, "")
    if (!submissionId) continue
    try {
      const res = await fetch(`${cfg.url}/api/integrations/content/score`, {
        method: "POST",
        headers: { "x-content-os-secret": cfg.secret, "content-type": "application/json" },
        body: JSON.stringify({ id: submissionId, quality_score: row.quality_score }),
      })
      if (!res.ok) {
        log("no se pudo avisar el puntaje a LoyalEngine (se reintenta en el próximo ciclo)", { asset: row.id, status: res.status })
        continue
      }
      await db.from("cos_assets").update({ embajador_scored_at: new Date().toISOString() }).eq("id", row.id)
      puntuadas++
    } catch (e) {
      log("no se pudo avisar el puntaje a LoyalEngine (se reintenta en el próximo ciclo)", { asset: row.id, error: String(e) })
    }
  }
  return puntuadas
}

export async function ingestEmbajadores(db: SupabaseClient, queue: Queue, log: (m: string, x?: Record<string, unknown>) => void) {
  const cfg = embajadoresConfig()
  if (!cfg) return { tomadas: 0, puntuadas: 0 }
  const tomadas = await ingestPending(db, queue, cfg, log)
  const puntuadas = await sweepScores(db, cfg, log)
  return { tomadas, puntuadas }
}

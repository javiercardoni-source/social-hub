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
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Queue } from "./queue.ts"
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
      const file = await fetch(it.download_url)
      if (!file.ok || !file.body) throw new Error(`descarga del material de embajador ${it.id}: HTTP ${file.status}`)
      const key = `originals/${brand.slug}/embajadores/${it.id}.${EXT[it.mime] ?? "bin"}`
      // Streaming directo de la descarga a cos-media: hasta 600 MB, no se junta en memoria
      // (el worker tiene 1,5 GB y ffmpeg corre en el mismo proceso más tarde).
      await supabaseStorage(db).upload(key, file.body, it.mime)
      const descripcion = (it.description ?? "").trim()
      const ins = await db
        .from("cos_assets")
        .insert({
          brand_id: brand.id,
          source: "embajadores",
          source_external_id: externalId,
          description: descripcion.length >= 15 ? descripcion.slice(0, 500) : `Material de ${it.submitted_by ?? "un embajador"} (Programa Embajadores)`,
          submitted_by_label: it.submitted_by,
          mime: it.mime,
          size_bytes: it.size_bytes,
          storage_driver: "supabase",
          storage_key: key,
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
      asset = ins.data
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

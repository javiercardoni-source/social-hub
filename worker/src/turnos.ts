/**
 * F3 — Historias de Turnos marcadas "para redes" (docs/CONTRATO-TURNOS.md v2).
 * Content OS consulta (pull); Turnos nunca llama. Apagado si faltan TURNOS_API_URL / CONTENT_OS_SECRET.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Queue } from "./queue.ts"
import { supabaseStorage } from "./storage.ts"

type Item = {
  id: string
  kind: string
  brand_slug: string
  submitted_by: string | null
  description: string | null
  mime: string
  size_bytes: number | null
  created_at: string
  download_url: string
}

export function turnosConfig() {
  const url = process.env.TURNOS_API_URL
  const secret = process.env.CONTENT_OS_SECRET
  return url && secret ? { url: url.replace(/\/$/, ""), secret } : null
}

const EXT: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

export async function ingestTurnos(db: SupabaseClient, queue: Queue, log: (m: string, x?: Record<string, unknown>) => void) {
  const cfg = turnosConfig()
  if (!cfg) return { tomadas: 0 }
  const res = await fetch(`${cfg.url}/api/v1/integrations/content/pending?limit=20`, { headers: { "x-content-os-secret": cfg.secret } })
  if (!res.ok) throw new Error(`Turnos pending: HTTP ${res.status}`)
  const { items } = (await res.json()) as { items: Item[] }
  let tomadas = 0
  for (const it of items) {
    const externalId = `${it.kind}:${it.id}`
    const { data: brand } = await db.from("cos_brands").select("id, slug").contains("turnos_slugs", [it.brand_slug]).eq("active", true).maybeSingle()
    if (!brand) {
      log("historia de una marca que Content OS no maneja (se saltea)", { turnos: it.id, brand: it.brand_slug })
      continue
    }
    // Idempotencia: si ya se tomó (y se cortó antes del ack), se reusa el asset.
    let { data: asset } = await db.from("cos_assets").select("id").eq("source", "turnos").eq("source_external_id", externalId).maybeSingle()
    if (!asset) {
      const file = await fetch(it.download_url)
      if (!file.ok) throw new Error(`descarga de la historia ${it.id}: HTTP ${file.status}`)
      const data = Buffer.from(await file.arrayBuffer())
      const key = `originals/${brand.slug}/turnos/${it.id}.${EXT[it.mime] ?? "bin"}`
      await supabaseStorage(db).upload(key, data, it.mime)
      const nota = (it.description ?? "").trim()
      const conNota = nota.length >= 15
      const ins = await db
        .from("cos_assets")
        .insert({
          brand_id: brand.id,
          source: "turnos",
          source_external_id: externalId,
          // Sin "¿qué es?" suficiente: la IA describe lo que ve (se reemplaza al clasificar).
          description: conNota ? nota.slice(0, 500) : `Historia de ${it.submitted_by ?? "alguien del equipo"} en Turnos${nota ? `: ${nota}` : ""}`,
          description_by_ai: !conNota,
          submitted_by_label: it.submitted_by,
          mime: it.mime,
          size_bytes: it.size_bytes ?? data.byteLength,
          storage_driver: "supabase",
          storage_key: key,
          status: "NEW",
        })
        .select("id")
        .single()
      if (ins.error || !ins.data) throw new Error(`asset de la historia ${it.id}: ${ins.error?.message}`)
      asset = ins.data
      await queue.enqueue("asset:process", { asset_id: asset.id }, { dedupeKey: `process:${asset.id}` })
    }
    const ack = await fetch(`${cfg.url}/api/v1/integrations/content/${it.id}/ack`, {
      method: "POST",
      headers: { "x-content-os-secret": cfg.secret, "content-type": "application/json" },
      body: JSON.stringify({ external_ref: asset.id }),
    })
    if (!ack.ok) throw new Error(`ack de la historia ${it.id}: HTTP ${ack.status}`)
    tomadas++
    log("historia de Turnos tomada", { turnos: it.id, asset: asset.id, brand: brand.slug })
  }
  return { tomadas }
}

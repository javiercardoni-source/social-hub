import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrls } from "@/lib/cos/storage"
import type { ActiveBrand } from "@/lib/cos/brand"
import { leerRitmo, type Ritmo } from "../../../shared/cos/agenda"
import type { Campania } from "../../../shared/cos/campanias"

/**
 * Datos del calendario para un rango de días (Buenos Aires): lo que propone la agenda (pendiente),
 * lo aprobado y lo publicado, con los feriados y las campañas de la marca.
 */
const AR_MS = 3 * 3600_000

export type EstadoCal = "propuesta" | "aprobada" | "publicada" | "problema" | "pausada"
export type PiezaCal = {
  id: string
  dia: string // YYYY-MM-DD
  hora: string // HH:MM
  minutos: number // desde las 0 h
  tipo: string
  plataforma: string
  estado: EstadoCal
  thumb: string | null
  imagen: string | null
  texto: string
  porque: string | null
  permalink: string | null
  marca: { name: string; color: string } | null
  /** Se pidió borrarla de la red y el worker todavía no confirmó (o falló: borrarError). */
  borrando: boolean
  borrarError: string | null
}
export type FechaCal = { dia: string; nombre: string; feriado: boolean }

type Row = {
  id: string
  platform: string
  post_type: string
  status: string
  caption: string
  scheduled_at: string | null
  published_at: string | null
  permalink: string | null
  render_key: string | null
  schedule_reason: string | null
  delete_requested_at: string | null
  delete_error: string | null
  cos_brands: { name: string; color: string } | null
  cos_post_media: { position: number; cos_asset_versions: { cos_assets: { thumb_key: string | null } | null } | null }[]
}

const sumar = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

export async function cargarCalendario(brand: ActiveBrand | null, desdeDia: string, hastaDia: string) {
  const db = createAdminClient()
  const desdeIso = new Date(Date.parse(`${desdeDia}T00:00:00Z`) + AR_MS).toISOString()
  const hastaIso = new Date(Date.parse(`${sumar(hastaDia, 1)}T00:00:00Z`) + AR_MS).toISOString()
  let q = db
    .from("cos_posts")
    .select(
      `id, platform, post_type, status, caption, scheduled_at, published_at, permalink, render_key, schedule_reason, delete_requested_at, delete_error,
       cos_brands(name, color),
       cos_post_media(position, cos_asset_versions(cos_assets!cos_asset_versions_asset_id_fkey(thumb_key)))`,
    )
    .in("status", ["PENDING_APPROVAL", "APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "RETRY_SCHEDULED", "FAILED", "PAUSED", "MISSED"])
    .eq("simulated", false)
    .is("deleted_at", null)
    .or(`and(scheduled_at.gte.${desdeIso},scheduled_at.lt.${hastaIso}),and(published_at.gte.${desdeIso},published_at.lt.${hastaIso})`)
    .limit(2000)
  if (brand) q = q.eq("brand_id", brand.id)
  let fq = db.from("cos_special_days").select("day, name, kind").gte("day", desdeDia).lte("day", hastaDia)
  if (brand) fq = fq.or(`brand_id.is.null,brand_id.eq.${brand.id}`)
  const [{ data, error }, { data: fechas }, { data: camps }, { data: marca }, { count: sinHora }, { data: marcas }] = await Promise.all([
    q,
    fq,
    brand ? db.from("cos_campaigns").select("*").eq("brand_id", brand.id).order("desde") : Promise.resolve({ data: [] }),
    brand ? db.from("cos_brands").select("ritmo").eq("id", brand.id).single() : Promise.resolve({ data: null }),
    brand
      ? db.from("cos_posts").select("id", { count: "exact", head: true }).eq("brand_id", brand.id).eq("status", "PENDING_APPROVAL").is("scheduled_at", null)
      : Promise.resolve({ count: 0 }),
    db.from("cos_brands").select("slug, name, color").eq("active", true).order("name"),
  ])
  if (error) throw new Error(`No se pudo cargar el calendario: ${error.message}`)
  const rows = (data ?? []) as unknown as Row[]
  const thumbKey = (p: Row) => [...p.cos_post_media].sort((a, b) => a.position - b.position)[0]?.cos_asset_versions?.cos_assets?.thumb_key ?? null
  // La pieza final si es imagen (post con plantilla, historia); si es video, la miniatura del original.
  const imagenKey = (p: Row) => (p.render_key && /\.jpe?g$/i.test(p.render_key) ? p.render_key : null)
  const urls = await signedUrls([...rows.map(thumbKey), ...rows.map(imagenKey)].filter(Boolean) as string[], 3 * 3600)

  const piezas: PiezaCal[] = []
  for (const p of rows) {
    const at = p.published_at ?? p.scheduled_at
    if (!at) continue
    const local = new Date(Date.parse(at) - AR_MS)
    const estado: EstadoCal =
      p.status === "PUBLISHED" ? "publicada" : p.status === "PENDING_APPROVAL" ? "propuesta" : ["FAILED", "MISSED"].includes(p.status) ? "problema" : p.status === "PAUSED" ? "pausada" : "aprobada"
    const tk = thumbKey(p)
    const ik = imagenKey(p)
    piezas.push({
      id: p.id,
      dia: local.toISOString().slice(0, 10),
      hora: local.toISOString().slice(11, 16),
      minutos: local.getUTCHours() * 60 + local.getUTCMinutes(),
      tipo: p.post_type,
      plataforma: p.platform,
      estado,
      thumb: tk ? (urls[tk] ?? null) : null,
      imagen: ik ? (urls[ik] ?? null) : tk ? (urls[tk] ?? null) : null,
      texto: p.caption,
      porque: p.schedule_reason,
      permalink: p.permalink,
      marca: brand ? null : p.cos_brands,
      borrando: !!p.delete_requested_at && !p.delete_error,
      borrarError: p.delete_error,
    })
  }
  piezas.sort((a, b) => a.dia.localeCompare(b.dia) || a.minutos - b.minutos)
  return {
    piezas,
    fechas: (fechas ?? []).map((f) => ({ dia: f.day as string, nombre: f.name as string, feriado: ["feriado", "puente"].includes(f.kind as string) })) as FechaCal[],
    campanias: (camps ?? []) as Campania[],
    ritmo: brand ? (leerRitmo(marca?.ritmo) as Ritmo) : null,
    sinHora: sinHora ?? 0,
    marcas: (marcas ?? []) as { slug: string; name: string; color: string }[],
  }
}

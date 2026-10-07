import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrls } from "@/lib/cos/storage"
import { getActiveBrand } from "@/lib/cos/brand"
import { leerRitmo } from "../../../../shared/cos/agenda"
import type { Campania } from "../../../../shared/cos/campanias"
import { MesClient, type DiaUI, type PiezaDia } from "./mes-client"
import { Campanias } from "./campanias-client"

/**
 * Calendario de verdad (07-10-2026): un mes en grilla con lo que propone la agenda (pendiente de
 * aprobar), lo aprobado y lo publicado; los feriados y las campañas de la marca como franjas.
 * La agenda mira 90 días, así que se navega una temporada entera.
 */
const AR_MS = 3 * 3600_000
const sumar = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const hoyBA = () => new Date(Date.now() - AR_MS).toISOString().slice(0, 10)

type Row = {
  id: string
  platform: string
  post_type: string
  status: string
  caption: string
  scheduled_at: string | null
  published_at: string | null
  permalink: string | null
  schedule_source: string | null
  schedule_reason: string | null
  cos_brands: { name: string; color: string } | null
  cos_post_media: { position: number; cos_asset_versions: { cos_assets: { thumb_key: string | null } | null } | null }[]
}

export async function VistaMes({ mes }: { mes: string }) {
  const brand = await getActiveBrand()
  const db = createAdminClient()
  const primero = `${mes}-01`
  const dowPrimero = new Date(`${primero}T12:00:00Z`).getUTCDay()
  const inicio = sumar(primero, -((dowPrimero + 6) % 7)) // lunes de la primera semana
  const siguiente = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 1)).toISOString().slice(0, 10)
  const ultimo = sumar(siguiente, -1)
  const dowUltimo = new Date(`${ultimo}T12:00:00Z`).getUTCDay()
  const fin = sumar(ultimo, (7 - dowUltimo) % 7) // domingo de la última semana
  const desdeIso = new Date(Date.parse(`${inicio}T00:00:00Z`) + AR_MS).toISOString()
  const hastaIso = new Date(Date.parse(`${sumar(fin, 1)}T00:00:00Z`) + AR_MS).toISOString()

  let q = db
    .from("cos_posts")
    .select(
      `id, platform, post_type, status, caption, scheduled_at, published_at, permalink, schedule_source, schedule_reason,
       cos_brands(name, color),
       cos_post_media(position, cos_asset_versions(cos_assets!cos_asset_versions_asset_id_fkey(thumb_key)))`,
    )
    .in("status", ["PENDING_APPROVAL", "APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "RETRY_SCHEDULED", "FAILED", "PAUSED", "MISSED"])
    .eq("simulated", false)
    .is("deleted_at", null)
    .or(`and(scheduled_at.gte.${desdeIso},scheduled_at.lt.${hastaIso}),and(published_at.gte.${desdeIso},published_at.lt.${hastaIso})`)
    .limit(1500)
  if (brand) q = q.eq("brand_id", brand.id)
  let fq = db.from("cos_special_days").select("day, name, kind").gte("day", inicio).lte("day", fin).in("kind", ["feriado", "puente", "especial", "marca", "evento"])
  if (brand) fq = fq.or(`brand_id.is.null,brand_id.eq.${brand.id}`)
  const [{ data, error }, { data: fechas }, { data: camps }, { data: marca }, { count: sinHora }] = await Promise.all([
    q,
    fq,
    brand ? db.from("cos_campaigns").select("*").eq("brand_id", brand.id).order("desde") : Promise.resolve({ data: [] }),
    brand ? db.from("cos_brands").select("ritmo").eq("id", brand.id).single() : Promise.resolve({ data: null }),
    brand
      ? db.from("cos_posts").select("id", { count: "exact", head: true }).eq("brand_id", brand.id).eq("status", "PENDING_APPROVAL").is("scheduled_at", null)
      : Promise.resolve({ count: 0 }),
  ])
  if (error) throw new Error(`No se pudo cargar el calendario: ${error.message}`)
  const rows = (data ?? []) as unknown as Row[]
  const thumbKey = (p: Row) => [...p.cos_post_media].sort((a, b) => a.position - b.position)[0]?.cos_asset_versions?.cos_assets?.thumb_key ?? null
  const urls = await signedUrls(rows.map(thumbKey).filter(Boolean) as string[], 3 * 3600)

  const porDia = new Map<string, PiezaDia[]>()
  for (const p of rows) {
    const at = p.published_at ?? p.scheduled_at
    if (!at) continue
    const local = new Date(Date.parse(at) - AR_MS)
    const dia = local.toISOString().slice(0, 10)
    const estado: PiezaDia["estado"] =
      p.status === "PUBLISHED" ? "publicada" : p.status === "PENDING_APPROVAL" ? "propuesta" : ["FAILED", "MISSED"].includes(p.status) ? "problema" : p.status === "PAUSED" ? "pausada" : "aprobada"
    const k = thumbKey(p)
    porDia.set(dia, [
      ...(porDia.get(dia) ?? []),
      {
        id: p.id,
        hora: local.toISOString().slice(11, 16),
        tipo: p.post_type,
        plataforma: p.platform,
        estado,
        thumb: k ? (urls[k] ?? null) : null,
        texto: p.caption.split("\n")[0]?.slice(0, 120) ?? "",
        porque: p.schedule_reason,
        permalink: p.permalink,
        marca: brand ? null : p.cos_brands,
      },
    ])
  }
  const campanias = (camps ?? []) as Campania[]
  const dias: DiaUI[] = []
  for (let d = inicio; d <= fin; d = sumar(d, 1)) {
    dias.push({
      dia: d,
      delMes: d.slice(0, 7) === mes,
      piezas: (porDia.get(d) ?? []).sort((a, b) => a.hora.localeCompare(b.hora)),
      fechas: (fechas ?? []).filter((f) => f.day === d).map((f) => ({ nombre: f.name as string, feriado: ["feriado", "puente"].includes(f.kind as string) })),
      campanias: campanias.filter((c) => c.activa && c.desde <= d && d <= c.hasta).map((c) => ({ id: c.id, nombre: c.nombre, color: c.color, inicia: c.desde === d || d === inicio || new Date(`${d}T12:00:00Z`).getUTCDay() === 1 })),
    })
  }

  return (
    <div className="space-y-6">
      <MesClient mes={mes} hoy={hoyBA()} dias={dias} marca={brand?.name ?? null} ritmo={brand ? leerRitmo(marca?.ritmo) : null} sinHora={sinHora ?? 0} />
      {brand ? (
        <Campanias campanias={campanias} hoy={hoyBA()} />
      ) : (
        <p className="rounded-xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">Elegí una marca arriba a la izquierda para ver y cargar sus campañas y su ritmo.</p>
      )}
    </div>
  )
}

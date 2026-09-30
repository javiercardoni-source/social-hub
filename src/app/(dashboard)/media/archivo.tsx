import Link from "next/link"
import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrls } from "@/lib/cos/storage"
import { PageHeader } from "@/components/dashboard/page-header"
import { cn } from "@/lib/utils"
import { TraerMaterial, type BaseEstado, type CarpetaBase } from "./archivo-client"
import { ArchivoGrid } from "./archivo-grid"

export function BibliotecaTabs({ activa }: { activa: "cocina" | "archivo" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link href={href} className={cn("rounded-full border px-3.5 py-1.5 text-sm font-semibold", on ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>
      {label}
    </Link>
  )
  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {tab("/media", "De la cocina", activa === "cocina")}
      {tab("/media?vista=archivo", "Archivo", activa === "archivo")}
    </div>
  )
}

type Row = {
  id: string
  description: string | null
  description_by_ai: boolean
  media_type: string | null
  status: string
  quality_score: number | null
  thumb_key: string | null
  source: string
  origin_path: string | null
  review_status: string
  consent: string
  ai_json: { category?: string; risk_flags?: string[] } | null
  created_at: string
  cos_brands: { name: string; color: string } | null
  cos_media: { metrics: Record<string, number>; posted_at: string } | null
}

export type Origen = "todo" | "drive" | "instagram" | "embajadores"

export async function ArchivoView(props: {
  brandId: string | null
  brandName: string | null
  estado: "pendientes" | "usados" | "descartados"
  orden: "calidad" | "recientes"
  origen: Origen
  tipo: "todo" | "fotos" | "videos"
}) {
  const db = createAdminClient()
  let q = db
    .from("cos_assets")
    .select(
      "id, description, description_by_ai, media_type, status, quality_score, thumb_key, source, origin_path, review_status, consent, ai_json, created_at, cos_brands(name, color), cos_media(metrics, posted_at)",
      { count: "exact" },
    )
    .eq("review_status", props.estado === "usados" ? "approved" : props.estado === "descartados" ? "discarded" : "pending")
    .limit(100)
  q = props.orden === "calidad" ? q.order("quality_score", { ascending: false, nullsFirst: false }) : q.order("created_at", { ascending: false })
  if (props.brandId) q = q.eq("brand_id", props.brandId)
  if (props.origen !== "todo") q = q.eq("source", props.origen)
  if (props.tipo !== "todo") q = q.like("mime", props.tipo === "fotos" ? "image/%" : "video/%")
  const { data, error, count } = await q
  if (error) throw new Error(`No se pudo cargar el archivo: ${error.message}`)
  const rows = (data ?? []) as unknown as Row[]
  const thumbs = await signedUrls(rows.map((r) => r.thumb_key).filter(Boolean) as string[])

  let pq = db.from("cos_assets").select("*", { count: "exact", head: true }).eq("review_status", "pending").in("status", ["NEW", "VALIDATING"])
  if (props.brandId) pq = pq.eq("brand_id", props.brandId)
  const { count: analizando } = await pq

  const { data: base } = props.brandId
    ? await db.from("cos_brands").select("base_folder_id, base_folder_name, base_folders, base_estado").eq("id", props.brandId).single()
    : { data: null }

  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ vista: "archivo", estado: props.estado, orden: props.orden, origen: props.origen, tipo: props.tipo, ...patch })
    return `/media?${p}`
  }
  const chip = (href: string, label: string, on: boolean) => (
    <Link href={href} className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", on ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
      {label}
    </Link>
  )

  return (
    <>
      <PageHeader
        title="Biblioteca"
        description={`${props.brandName ? `${props.brandName} · ` : ""}Archivo: ${count ?? 0} ${props.estado === "usados" ? "elegidos" : props.estado === "descartados" ? "descartados" : "para revisar"}${analizando ? ` · ${analizando} analizándose` : ""}`}
      />
      <div className="p-6">
        <BibliotecaTabs activa="archivo" />
        {props.brandId && props.brandName && (
          <TraerMaterial
            brandId={props.brandId}
            brandName={props.brandName}
            folderId={base?.base_folder_id ?? null}
            folderName={base?.base_folder_name ?? null}
            carpetas={(Array.isArray(base?.base_folders) ? base.base_folders : []) as CarpetaBase[]}
            estado={(base?.base_estado as BaseEstado | null) ?? null}
          />
        )}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {chip(link({ estado: "pendientes" }), "Para revisar", props.estado === "pendientes")}
          {chip(link({ estado: "usados" }), "Elegidos", props.estado === "usados")}
          {chip(link({ estado: "descartados" }), "Descartados", props.estado === "descartados")}
          <span className="mx-1 text-muted-foreground">·</span>
          {chip(link({ orden: "calidad" }), "Mejor calidad primero", props.orden === "calidad")}
          {chip(link({ orden: "recientes" }), "Más nuevos", props.orden === "recientes")}
          <span className="mx-1 text-muted-foreground">·</span>
          {chip(link({ origen: "todo" }), "Todo", props.origen === "todo")}
          {chip(link({ origen: "drive" }), "Base de fotos", props.origen === "drive")}
          {chip(link({ origen: "instagram" }), "Instagram", props.origen === "instagram")}
          {chip(link({ origen: "embajadores" }), "Embajadores", props.origen === "embajadores")}
          <span className="mx-1 text-muted-foreground">·</span>
          {chip(link({ tipo: "todo" }), "Fotos y videos", props.tipo === "todo")}
          {chip(link({ tipo: "fotos" }), "Fotos", props.tipo === "fotos")}
          {chip(link({ tipo: "videos" }), "Videos", props.tipo === "videos")}
        </div>
        {!props.brandId && (
          <p className="mb-4 text-xs text-muted-foreground">Elegí una marca arriba para traer material de su base de fotos o de su Instagram.</p>
        )}
        {rows.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed p-10 text-center text-sm text-muted-foreground">
            {props.estado === "usados" ? "Todavía no elegiste nada del archivo." : props.estado === "descartados" ? "No descartaste nada." : "No hay material para revisar. Traé una tanda de la base de fotos o lo publicado en Instagram."}
          </div>
        ) : (
          <ArchivoGrid
            estado={props.estado}
            items={rows.map((r) => ({
              id: r.id,
              description: r.description,
              media_type: r.media_type,
              status: r.status,
              quality_score: r.quality_score,
              thumb: r.thumb_key ? (thumbs[r.thumb_key] ?? null) : null,
              source: r.source,
              review_status: r.review_status,
              category: r.ai_json?.category ?? null,
              risk_flags: r.ai_json?.risk_flags ?? [],
              consent: r.consent,
              brand: r.cos_brands,
              rend: r.cos_media?.metrics ?? null,
            }))}
          />
        )}
      </div>
    </>
  )
}

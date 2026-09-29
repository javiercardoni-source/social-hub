import Link from "next/link"
import Image from "next/image"
import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrls } from "@/lib/cos/storage"
import { PageHeader } from "@/components/dashboard/page-header"
import { cn } from "@/lib/utils"
import { ArchivoAcciones, TraerMaterial, type BaseEstado } from "./archivo-client"

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
  ai_json: { category?: string; risk_flags?: string[] } | null
  created_at: string
  cos_brands: { name: string; color: string } | null
  cos_media: { metrics: Record<string, number>; posted_at: string } | null
}

export type Origen = "todo" | "drive" | "instagram"

export async function ArchivoView(props: {
  brandId: string | null
  brandName: string | null
  estado: "pendientes" | "usados"
  orden: "calidad" | "recientes"
  origen: Origen
}) {
  const db = createAdminClient()
  let q = db
    .from("cos_assets")
    .select(
      "id, description, description_by_ai, media_type, status, quality_score, thumb_key, source, origin_path, review_status, ai_json, created_at, cos_brands(name, color), cos_media(metrics, posted_at)",
      { count: "exact" },
    )
    .eq("review_status", props.estado === "usados" ? "approved" : "pending")
    .limit(60)
  q = props.orden === "calidad" ? q.order("quality_score", { ascending: false, nullsFirst: false }) : q.order("created_at", { ascending: false })
  if (props.brandId) q = q.eq("brand_id", props.brandId)
  if (props.origen !== "todo") q = q.eq("source", props.origen)
  const { data, error, count } = await q
  if (error) throw new Error(`No se pudo cargar el archivo: ${error.message}`)
  const rows = (data ?? []) as unknown as Row[]
  const thumbs = await signedUrls(rows.map((r) => r.thumb_key).filter(Boolean) as string[])

  let pq = db.from("cos_assets").select("*", { count: "exact", head: true }).eq("review_status", "pending").in("status", ["NEW", "VALIDATING"])
  if (props.brandId) pq = pq.eq("brand_id", props.brandId)
  const { count: analizando } = await pq

  const { data: base } = props.brandId
    ? await db.from("cos_brands").select("base_folder_id, base_folder_name, base_estado").eq("id", props.brandId).single()
    : { data: null }

  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ vista: "archivo", estado: props.estado, orden: props.orden, origen: props.origen, ...patch })
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
        description={`${props.brandName ? `${props.brandName} · ` : ""}Archivo: ${count ?? 0} ${props.estado === "usados" ? "elegidos" : "para revisar"}${analizando ? ` · ${analizando} analizándose` : ""}`}
      />
      <div className="p-6">
        <BibliotecaTabs activa="archivo" />
        {props.brandId && props.brandName && (
          <TraerMaterial
            brandId={props.brandId}
            brandName={props.brandName}
            folderId={base?.base_folder_id ?? null}
            folderName={base?.base_folder_name ?? null}
            estado={(base?.base_estado as BaseEstado | null) ?? null}
          />
        )}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {chip(link({ estado: "pendientes" }), "Para revisar", props.estado === "pendientes")}
          {chip(link({ estado: "usados" }), "Elegidos", props.estado === "usados")}
          <span className="mx-1 text-muted-foreground">·</span>
          {chip(link({ orden: "calidad" }), "Mejor calidad primero", props.orden === "calidad")}
          {chip(link({ orden: "recientes" }), "Más nuevos", props.orden === "recientes")}
          <span className="mx-1 text-muted-foreground">·</span>
          {chip(link({ origen: "todo" }), "Todo", props.origen === "todo")}
          {chip(link({ origen: "drive" }), "Base de fotos", props.origen === "drive")}
          {chip(link({ origen: "instagram" }), "Instagram", props.origen === "instagram")}
        </div>
        {!props.brandId && (
          <p className="mb-4 text-xs text-muted-foreground">Elegí una marca arriba para traer material de su base de fotos o de su Instagram.</p>
        )}
        {rows.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed p-10 text-center text-sm text-muted-foreground">
            {props.estado === "usados" ? "Todavía no elegiste nada del archivo." : "No hay material para revisar. Traé una tanda de la base de fotos o lo publicado en Instagram."}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {rows.map((r) => {
              const t = r.thumb_key ? thumbs[r.thumb_key] : null
              const analizado = ["READY", "IN_USE"].includes(r.status) && r.quality_score != null
              const rend = r.cos_media?.metrics
              return (
                <div key={r.id} className="flex flex-col overflow-hidden rounded-xl border bg-card">
                  <div className="relative aspect-square bg-muted">
                    {t && <Image src={t} alt="" fill className="object-cover" sizes="220px" />}
                    <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {r.source === "instagram" ? "Ya publicado en IG" : r.source === "drive" ? "Base de fotos" : "Carpeta"}
                    </span>
                    {r.media_type === "video" && <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">Video</span>}
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 p-2.5 text-xs">
                    {analizado ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="font-bold">Calidad {r.quality_score}</span>
                          {r.cos_brands && (
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.cos_brands.color }} />
                              {r.cos_brands.name}
                            </span>
                          )}
                        </div>
                        <p className="line-clamp-3 text-muted-foreground">{r.description}</p>
                        {r.ai_json?.category && <p className="text-[10px] text-muted-foreground/70">{r.ai_json.category}</p>}
                        {rend && (
                          <p className="text-[10px] font-medium text-emerald-700">
                            Cuando se publicó: {(rend.reach || rend.views || 0).toLocaleString("es-AR")} {rend.reach ? "alcance" : "vistas"} · {rend.total_interactions ?? 0} interacc.
                          </p>
                        )}
                        {!!r.ai_json?.risk_flags?.length && <p className="text-[10px] text-amber-700">⚠ {r.ai_json.risk_flags.join(", ").replace(/_/g, " ")}</p>}
                      </>
                    ) : (
                      <p className="text-muted-foreground">La IA lo está analizando…</p>
                    )}
                    <div className="mt-auto pt-1">
                      <ArchivoAcciones id={r.id} listo={analizado} usado={r.review_status === "approved"} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

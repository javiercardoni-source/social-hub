import Link from "next/link"
import Image from "next/image"
import { requireMember } from "@/lib/cos/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrls } from "@/lib/cos/storage"
import { getActiveBrand } from "@/lib/cos/brand"
import { PageHeader } from "@/components/dashboard/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PenSquare, AlertTriangle, Video, Image as ImageIcon, Upload } from "lucide-react"
import { ArchivoView, BibliotecaTabs } from "./archivo"
import { MarcaReel, SeleccionReel } from "./cocina-reel"
import { PermisoCocina } from "./archivo-client"

export const dynamic = "force-dynamic"

type AssetRow = {
  id: string
  description: string | null
  media_type: string | null
  status: string
  quality_score: number | null
  thumb_key: string | null
  consent: string
  size_bytes: number | null
  duration_ms: number | null
  submitted_by_label: string | null
  kitchen_label: string | null
  created_at: string
  ai_json: { category?: string; mood?: string; risk_flags?: string[]; suggested_formats?: string[] } | null
  cos_brands: { name: string; color: string; slug: string } | null
}

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  NEW: { label: "Nuevo", variant: "secondary" },
  VALIDATING: { label: "Procesando", variant: "secondary" },
  READY: { label: "Listo", variant: "default" },
  IN_USE: { label: "En uso", variant: "default" },
  MISSING_DESCRIPTION: { label: "Sin descripción", variant: "destructive" },
  FAILED_PROCESSING: { label: "Error", variant: "destructive" },
  ARCHIVED: { label: "Archivado", variant: "outline" },
  REJECTED: { label: "Rechazado", variant: "destructive" },
}

function qColor(score: number | null) {
  if (score == null) return "text-muted-foreground"
  if (score >= 70) return "text-emerald-600 dark:text-emerald-400"
  if (score >= 45) return "text-amber-600 dark:text-amber-400"
  return "text-red-500"
}

function formatSize(bytes: number | null) {
  if (!bytes) return null
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${Math.round(bytes / 1_000)} KB`
}

function formatDuration(ms: number | null) {
  if (!ms) return null
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min` : `${s}s`
}

export default async function BibliotecaPage({ searchParams }: { searchParams: Promise<{ vista?: string; estado?: string; orden?: string; origen?: string; tipo?: string }> }) {
  await requireMember("viewer")
  const db = createAdminClient()
  const sp = await searchParams
  const brand = await getActiveBrand()

  // Pestaña Archivo (F2): el material que ya existía, para revisar y elegir.
  if (sp.vista === "archivo") {
    return <ArchivoView brandId={brand?.id ?? null} brandName={brand?.name ?? null} estado={sp.estado === "usados" || sp.estado === "descartados" ? sp.estado : "pendientes"} orden={sp.orden === "recientes" ? "recientes" : "calidad"}
        origen={sp.origen === "drive" || sp.origen === "instagram" || sp.origen === "embajadores" ? sp.origen : "todo"}
        tipo={sp.tipo === "fotos" || sp.tipo === "videos" ? sp.tipo : "todo"}
      />
  }

  let query = db
    .from("cos_assets")
    .select(
      "id, description, media_type, status, quality_score, thumb_key, consent, size_bytes, duration_ms, submitted_by_label, kitchen_label, created_at, ai_json, cos_brands(name, color, slug)"
    )
    .neq("status", "ARCHIVED")
    .is("review_status", null)
    .neq("source", "sistema")
    .order("created_at", { ascending: false })
    .limit(60)
  if (brand) query = query.eq("brand_id", brand.id)
  const { data: assets, error } = await query
  if (error) throw new Error(`No se pudo cargar la biblioteca: ${error.message}`)

  const rows = (assets ?? []) as unknown as AssetRow[]
  const thumbKeys = rows.map((a) => a.thumb_key).filter(Boolean) as string[]
  const thumbMap = await signedUrls(thumbKeys)

  const readyCount = rows.filter((a) => ["READY", "IN_USE"].includes(a.status)).length

  return (
    <>
      <PageHeader
        title="Biblioteca"
        description={`${brand ? `${brand.name} · ` : ""}${rows.length} archivos · ${readyCount} listos para publicar`}
      >
        <Button asChild size="sm" className="font-semibold">
          <Link href="/media/subir">
            <Upload className="h-4 w-4" />
            Subir
          </Link>
        </Button>
      </PageHeader>

      <div className="p-6">
        <BibliotecaTabs activa="cocina" />
        {rows.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed text-center">
            <ImageIcon className="h-10 w-10 text-muted-foreground/30" />
            <div>
              <p className="font-medium">Sin archivos todavía</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Los empleados los envían desde la PWA de Turnos.
              </p>
            </div>
          </div>
        ) : (
          <SeleccionReel>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {rows.map((asset) => {
              const thumb = asset.thumb_key ? thumbMap[asset.thumb_key] : null
              const brand = asset.cos_brands
              const { label, variant } = STATUS_MAP[asset.status] ?? { label: asset.status, variant: "secondary" as const }
              const isReady = ["READY", "IN_USE"].includes(asset.status)
              const hasConsent = asset.consent === "blocked"

              return (
                <div
                  key={asset.id}
                  className="group relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md"
                >
                  {/* Thumbnail */}
                  <div className="relative aspect-square overflow-hidden bg-muted">
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={asset.description ?? "asset"}
                        fill
                        className="object-cover transition-transform group-hover:scale-105"
                        sizes="220px"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        {asset.media_type === "video" ? (
                          <Video className="h-10 w-10 text-muted-foreground/25" />
                        ) : (
                          <ImageIcon className="h-10 w-10 text-muted-foreground/25" />
                        )}
                      </div>
                    )}

                    {/* Overlay con badges */}
                    <div className="absolute inset-x-0 top-0 flex items-start justify-between p-2">
                      {brand && (
                        <div
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                          style={{ backgroundColor: brand.color + "ee" }}
                        >
                          {brand.name}
                        </div>
                      )}
                      {hasConsent && (
                        <div className="rounded bg-red-500 p-1 shadow-sm">
                          <AlertTriangle className="h-3 w-3 text-white" />
                        </div>
                      )}
                    </div>

                    {/* Marcar para armar un reel con varias piezas (F9) */}
                    {isReady && !hasConsent && <MarcaReel id={asset.id} />}

                    {/* Video duration */}
                    {asset.media_type === "video" && asset.duration_ms && (
                      <div className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                        {formatDuration(asset.duration_ms)}
                      </div>
                    )}

                    {/* Acción: crear post */}
                    {isReady && (
                      <Link
                        href={`/composer?asset=${asset.id}`}
                        className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100"
                      >
                        <Button size="sm" className="gap-1 shadow-lg">
                          <PenSquare className="h-3.5 w-3.5" />
                          Crear post
                        </Button>
                      </Link>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex flex-col gap-1.5 p-3">
                    <div className="flex items-center justify-between gap-1">
                      <Badge variant={variant} className="px-1.5 py-0 text-[10px]">{label}</Badge>
                      {asset.quality_score != null && (
                        <span className={`text-xs font-semibold ${qColor(asset.quality_score)}`}>
                          Q{asset.quality_score}
                        </span>
                      )}
                    </div>

                    <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                      {asset.description ?? <span className="italic">Sin descripción</span>}
                    </p>

                    {asset.ai_json?.category && (
                      <p className="truncate text-[10px] text-muted-foreground/70">
                        {asset.ai_json.category}
                        {asset.ai_json.mood ? ` · ${asset.ai_json.mood}` : ""}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>
                        {new Date(asset.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                      </span>
                      {formatSize(asset.size_bytes) && (
                        <span>{formatSize(asset.size_bytes)}</span>
                      )}
                    </div>
                    {hasConsent && <PermisoCocina id={asset.id} />}
                  </div>
                </div>
              )
            })}
          </div>
          </SeleccionReel>
        )}
      </div>
    </>
  )
}

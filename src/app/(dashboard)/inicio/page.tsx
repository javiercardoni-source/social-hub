import Link from "next/link"
import Image from "next/image"
import { requireMember } from "@/lib/cos/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrls } from "@/lib/cos/storage"
import { PageHeader } from "@/components/dashboard/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CheckCircle, Images, CalendarClock, Zap, ArrowRight, Clock } from "lucide-react"

type AssetRow = {
  id: string
  description: string | null
  media_type: string | null
  status: string
  quality_score: number | null
  thumb_key: string | null
  created_at: string
  cos_brands: { name: string; color: string; slug: string } | null
}

function qColor(score: number | null) {
  if (!score) return "text-muted-foreground"
  if (score >= 70) return "text-emerald-600"
  if (score >= 45) return "text-amber-600"
  return "text-red-500"
}

function statusLabel(s: string) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    NEW: { label: "Nuevo", variant: "secondary" },
    VALIDATING: { label: "Procesando", variant: "secondary" },
    READY: { label: "Listo", variant: "default" },
    IN_USE: { label: "En uso", variant: "default" },
    MISSING_DESCRIPTION: { label: "Sin descripción", variant: "destructive" },
    FAILED_PROCESSING: { label: "Error", variant: "destructive" },
    ARCHIVED: { label: "Archivado", variant: "outline" },
  }
  return map[s] ?? { label: s, variant: "secondary" as const }
}

function postStatusLabel(s: string) {
  const map: Record<string, string> = {
    PENDING_APPROVAL: "Para aprobar",
    APPROVED: "Aprobado",
    SCHEDULED: "Programado",
    PUBLISHING: "Publicando",
    PUBLISHED: "Publicado",
    FAILED: "Falló",
    RETRY_SCHEDULED: "Reintentando",
    MISSED: "Perdido",
    EXPIRED: "Vencido",
    REJECTED: "Rechazado",
  }
  return map[s] ?? s
}

export default async function InicioPage() {
  await requireMember("viewer")
  const db = createAdminClient()

  // Stats en paralelo
  const [pendingResult, scheduledResult, readyResult, processingResult, recentAssetsResult] =
    await Promise.all([
      db.from("cos_posts").select("*", { count: "exact", head: true }).eq("status", "PENDING_APPROVAL"),
      db.from("cos_posts").select("*", { count: "exact", head: true }).in("status", ["SCHEDULED", "APPROVED"]),
      db.from("cos_assets").select("*", { count: "exact", head: true }).in("status", ["READY", "IN_USE"]),
      db.from("cos_assets").select("*", { count: "exact", head: true }).in("status", ["NEW", "VALIDATING"]),
      db
        .from("cos_assets")
        .select("id, description, media_type, status, quality_score, thumb_key, created_at, cos_brands(name, color, slug)")
        .order("created_at", { ascending: false })
        .limit(8),
    ])

  const pendingCount = pendingResult.count ?? 0
  const scheduledCount = scheduledResult.count ?? 0
  const readyCount = readyResult.count ?? 0
  const processingCount = processingResult.count ?? 0
  const recentAssets = (recentAssetsResult.data ?? []) as unknown as AssetRow[]

  // URLs firmadas para miniaturas
  const thumbKeys = recentAssets.map((a) => a.thumb_key).filter(Boolean) as string[]
  const thumbMap = await signedUrls(thumbKeys)

  // Posts recientes para actividad
  const { data: recentPosts } = await db
    .from("cos_posts")
    .select("id, status, caption, platform, post_type, scheduled_at, created_at, cos_brands(name, color)")
    .order("created_at", { ascending: false })
    .limit(5)

  return (
    <>
      <PageHeader title="Inicio" description="Resumen de Content OS" />

      <div className="space-y-6 p-6">
        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Para aprobar</p>
                  <p className="mt-1 text-2xl font-bold">{pendingCount}</p>
                </div>
                <div className="rounded-lg bg-amber-100 p-2 dark:bg-amber-900/30">
                  <CheckCircle className="h-5 w-5 text-amber-600" />
                </div>
              </div>
              {pendingCount > 0 && (
                <Link href="/aprobaciones" className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline">
                  Ver pendientes <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Programados</p>
                  <p className="mt-1 text-2xl font-bold">{scheduledCount}</p>
                </div>
                <div className="rounded-lg bg-blue-100 p-2 dark:bg-blue-900/30">
                  <CalendarClock className="h-5 w-5 text-blue-600" />
                </div>
              </div>
              <Link href="/calendar" className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                Ver calendario <ArrowRight className="h-3 w-3" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Assets listos</p>
                  <p className="mt-1 text-2xl font-bold">{readyCount}</p>
                </div>
                <div className="rounded-lg bg-emerald-100 p-2 dark:bg-emerald-900/30">
                  <Images className="h-5 w-5 text-emerald-600" />
                </div>
              </div>
              <Link href="/media" className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                Ir a biblioteca <ArrowRight className="h-3 w-3" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">En proceso</p>
                  <p className="mt-1 text-2xl font-bold">{processingCount}</p>
                </div>
                <div className="rounded-lg bg-violet-100 p-2 dark:bg-violet-900/30">
                  <Zap className="h-5 w-5 text-violet-600" />
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Worker clasificando</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* Assets recientes */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Assets recientes</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/media">Ver todos <ArrowRight className="ml-1 h-3 w-3" /></Link>
              </Button>
            </CardHeader>
            <CardContent>
              {recentAssets.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                  <Images className="h-8 w-8 opacity-30" />
                  <p>Todavía no hay assets. Subí el primero.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {recentAssets.map((asset) => {
                    const thumb = asset.thumb_key ? thumbMap[asset.thumb_key] : null
                    const brand = asset.cos_brands
                    const { label, variant } = statusLabel(asset.status)
                    return (
                      <Link
                        key={asset.id}
                        href={`/composer?asset=${asset.id}`}
                        className="group relative overflow-hidden rounded-lg border bg-muted/30 transition-colors hover:border-primary/50"
                      >
                        <div className="aspect-square">
                          {thumb ? (
                            <Image
                              src={thumb}
                              alt={asset.description ?? "asset"}
                              fill
                              className="object-cover transition-transform group-hover:scale-105"
                              sizes="160px"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center">
                              <Images className="h-8 w-8 text-muted-foreground/30" />
                            </div>
                          )}
                        </div>
                        <div className="p-2">
                          {brand && (
                            <div className="mb-1 flex items-center gap-1">
                              <div
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ backgroundColor: brand.color }}
                              />
                              <span className="truncate text-xs text-muted-foreground">{brand.name}</span>
                            </div>
                          )}
                          <Badge variant={variant} className="text-[10px] px-1 py-0">{label}</Badge>
                          {asset.quality_score != null && (
                            <span className={`ml-1 text-xs font-medium ${qColor(asset.quality_score)}`}>
                              Q{asset.quality_score}
                            </span>
                          )}
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actividad reciente */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Actividad</CardTitle>
            </CardHeader>
            <CardContent>
              {!recentPosts || recentPosts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin posts todavía.</p>
              ) : (
                <div className="space-y-3">
                  {recentPosts.map((rawPost) => {
                    const p = rawPost as unknown as { id: string; status: string; caption: string; created_at: string; cos_brands: { name: string; color: string } | null }
                    return (
                      <div key={p.id} className="flex items-start gap-3">
                        {p.cos_brands && (
                          <div
                            className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: p.cos_brands.color }}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">
                            {p.caption || "(sin caption)"}
                          </p>
                          <div className="mt-0.5 flex items-center gap-2">
                            <Badge
                              variant={p.status === "PENDING_APPROVAL" ? "default" : "secondary"}
                              className="text-[10px] px-1 py-0"
                            >
                              {postStatusLabel(p.status)}
                            </Badge>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {new Date(p.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

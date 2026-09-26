import Link from "next/link"
import { requireMember } from "@/lib/cos/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { PageHeader } from "@/components/dashboard/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Clock, CheckCircle, AlertCircle, XCircle } from "lucide-react"
import { PlatformIcon } from "@/components/ui/platform-icon"

export const dynamic = "force-dynamic"

const ACTIVE_STATUSES = ["SCHEDULED", "APPROVED", "PUBLISHING", "PUBLISHED", "FAILED", "RETRY_SCHEDULED", "MISSED", "PAUSED"]

type PostRow = {
  id: string
  caption: string
  platform: string
  post_type: string
  status: string
  scheduled_at: string | null
  published_at: string | null
  simulated: boolean | null
  last_error: string | null
  cos_brands: { name: string; color: string } | null
}

function statusInfo(s: string): { label: string; icon: React.ReactNode; className: string } {
  const props: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
    SCHEDULED: { label: "Programado", icon: <Clock className="h-3 w-3" />, className: "bg-blue-100 text-blue-700 border-blue-200" },
    APPROVED: { label: "Aprobado", icon: <CheckCircle className="h-3 w-3" />, className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    PUBLISHING: { label: "Publicando…", icon: <Clock className="h-3 w-3 animate-spin" />, className: "bg-violet-100 text-violet-700 border-violet-200" },
    PUBLISHED: { label: "Publicado", icon: <CheckCircle className="h-3 w-3" />, className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    FAILED: { label: "Falló", icon: <AlertCircle className="h-3 w-3" />, className: "bg-red-100 text-red-700 border-red-200" },
    RETRY_SCHEDULED: { label: "Reintentando", icon: <Clock className="h-3 w-3" />, className: "bg-amber-100 text-amber-700 border-amber-200" },
    MISSED: { label: "Perdido", icon: <XCircle className="h-3 w-3" />, className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
    PAUSED: { label: "Pausado", icon: <Clock className="h-3 w-3" />, className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  }
  return props[s] ?? { label: s, icon: null, className: "bg-zinc-100 text-zinc-600 border-zinc-200" }
}


function formatDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default async function ProgramadosPage() {
  await requireMember("viewer")
  const db = createAdminClient()

  const { data: posts } = await db
    .from("cos_posts")
    .select("id, caption, platform, post_type, status, scheduled_at, published_at, simulated, last_error, cos_brands(name, color)")
    .in("status", ACTIVE_STATUSES)
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(50)

  const rows = (posts ?? []) as unknown as PostRow[]
  const scheduledCount = rows.filter((p) => ["SCHEDULED", "APPROVED"].includes(p.status)).length
  const publishedCount = rows.filter((p) => p.status === "PUBLISHED").length

  return (
    <>
      <PageHeader
        title="Programados"
        description={`${scheduledCount} pendientes · ${publishedCount} publicados`}
      />

      <div className="p-6">
        {rows.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed text-center">
            <Clock className="h-10 w-10 text-muted-foreground/30" />
            <div>
              <p className="font-medium">Sin posts todavía</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Aprobá posts desde <Link href="/aprobaciones" className="text-primary hover:underline">Aprobaciones</Link> para verlos acá.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((post) => {
              const { label, icon, className } = statusInfo(post.status)
              const brand = post.cos_brands
              const isPublished = post.status === "PUBLISHED"
              return (
                <Card key={post.id} className={isPublished ? "opacity-70" : undefined}>
                  <CardContent className="flex items-start gap-4 p-4">
                    {/* Fecha */}
                    <div className="w-32 shrink-0 text-center">
                      <p className="text-xs font-medium text-muted-foreground">
                        {isPublished ? "Publicado" : "Programado"}
                      </p>
                      <p className="mt-0.5 text-xs text-foreground">
                        {formatDate(isPublished ? post.published_at : post.scheduled_at)}
                      </p>
                    </div>

                    {/* Marca e info */}
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {brand && (
                        <div
                          className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: brand.color }}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{post.caption || "(sin caption)"}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${className}`}>
                            {icon}
                            {label}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            <PlatformIcon platform={post.platform} />
                            {post.platform === "instagram" ? "IG" : "FB"} · {post.post_type}
                          </span>
                          {post.simulated && (
                            <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              simulado
                            </span>
                          )}
                          {brand && (
                            <span className="text-[10px] text-muted-foreground">{brand.name}</span>
                          )}
                        </div>
                        {post.last_error && (
                          <p className="mt-1 text-xs text-red-500">{post.last_error}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

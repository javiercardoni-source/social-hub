import Link from "next/link"
import Image from "next/image"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrls } from "@/lib/cos/storage"
import { PageHeader } from "@/components/dashboard/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { PlatformIcon } from "@/components/ui/platform-icon"
import { Clock, CheckCircle, AlertCircle, XCircle, ExternalLink, Images } from "lucide-react"
import { AccionesPost } from "./acciones-post"

export const dynamic = "force-dynamic"

const AR = "America/Argentina/Buenos_Aires"
const SHOWN = ["SCHEDULED", "APPROVED", "PUBLISHING", "PUBLISHED", "FAILED", "RETRY_SCHEDULED", "MISSED", "PAUSED", "EXPIRED"]

type PostRow = {
  id: string
  caption: string
  platform: string
  post_type: string
  status: string
  scheduled_at: string | null
  published_at: string | null
  permalink: string | null
  last_error: string | null
  attempts: number
  deleted_at: string | null
  delete_requested_at: string | null
  delete_error: string | null
  cos_brands: { name: string; color: string } | null
  cos_post_media: { position: number; cos_asset_versions: { cos_assets: { thumb_key: string | null } | null } | null }[]
}

const STATUS: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  SCHEDULED: { label: "Programado", icon: <Clock className="h-3 w-3" />, className: "bg-blue-100 text-blue-700 border-blue-200" },
  APPROVED: { label: "Aprobado", icon: <CheckCircle className="h-3 w-3" />, className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  PUBLISHING: { label: "Publicando…", icon: <Clock className="h-3 w-3 animate-spin" />, className: "bg-violet-100 text-violet-700 border-violet-200" },
  PUBLISHED: { label: "Publicado", icon: <CheckCircle className="h-3 w-3" />, className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  FAILED: { label: "Falló", icon: <AlertCircle className="h-3 w-3" />, className: "bg-red-100 text-red-700 border-red-200" },
  RETRY_SCHEDULED: { label: "Reintentando", icon: <Clock className="h-3 w-3" />, className: "bg-amber-100 text-amber-700 border-amber-200" },
  MISSED: { label: "Se pasó la hora", icon: <XCircle className="h-3 w-3" />, className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  EXPIRED: { label: "Venció sin aprobar", icon: <XCircle className="h-3 w-3" />, className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  PAUSED: { label: "En pausa", icon: <Clock className="h-3 w-3" />, className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
}

const TYPE: Record<string, string> = { feed: "Post", reel: "Reel", story: "Historia", carousel: "Carrusel" }

function when(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("es-AR", { timeZone: AR, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

export default async function CalendarioPage() {
  await requireMember("viewer")
  const brand = await getActiveBrand()
  const db = createAdminClient()

  let query = db
    .from("cos_posts")
    .select(
      `id, caption, platform, post_type, status, scheduled_at, published_at, permalink, last_error, attempts,
       deleted_at, delete_requested_at, delete_error,
       cos_brands(name, color),
       cos_post_media(position, cos_asset_versions(cos_assets!cos_asset_versions_asset_id_fkey(thumb_key)))`,
    )
    .in("status", SHOWN)
    .eq("simulated", false)
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .limit(80)
  if (brand) query = query.eq("brand_id", brand.id)
  const { data, error } = await query
  if (error) throw new Error(`No se pudo cargar el calendario: ${error.message}`)
  const rows = (data ?? []) as unknown as PostRow[]

  const thumbOf = (p: PostRow) => p.cos_post_media.find((m) => m.position === 0)?.cos_asset_versions?.cos_assets?.thumb_key ?? null
  const thumbs = await signedUrls(rows.map(thumbOf).filter(Boolean) as string[])

  const upcoming = rows.filter((p) => ["SCHEDULED", "APPROVED", "PUBLISHING", "RETRY_SCHEDULED", "PAUSED"].includes(p.status)).reverse()
  const problems = rows.filter((p) => ["FAILED", "MISSED", "EXPIRED"].includes(p.status))
  const published = rows.filter((p) => p.status === "PUBLISHED")

  const section = (title: string, list: PostRow[], empty: string) => (
    <section className="space-y-2">
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
        {title} <span className="font-normal">({list.length})</span>
      </h2>
      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        list.map((p) => {
          const st = STATUS[p.status] ?? { label: p.status, icon: null, className: "bg-zinc-100 text-zinc-600" }
          const thumb = thumbOf(p) ? thumbs[thumbOf(p)!] : null
          return (
            <Card key={p.id} className={p.deleted_at ? "opacity-60" : undefined}>
              <CardContent className="flex items-start gap-3 p-3">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {thumb ? (
                    <Image src={thumb} alt="" fill className="object-cover" sizes="64px" />
                  ) : (
                    <Images className="m-auto mt-5 h-6 w-6 text-muted-foreground/30" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${st.className}`}>
                      {st.icon}
                      {st.label}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      <PlatformIcon platform={p.platform} className="h-3 w-3" />
                      {TYPE[p.post_type] ?? p.post_type}
                    </span>
                    {p.cos_brands && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.cos_brands.color }} />
                        {p.cos_brands.name}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      · {p.status === "PUBLISHED" ? when(p.published_at) : when(p.scheduled_at)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm">{p.caption || (p.post_type === "story" ? "Historia (sin texto)" : "(sin texto)")}</p>
                  {p.deleted_at && <p className="mt-1 text-xs font-medium text-muted-foreground">Borrado de la red el {when(p.deleted_at)}</p>}
                  {p.delete_error && !p.deleted_at && <p className="mt-1 text-xs text-red-600">{p.delete_error}</p>}
                  {p.last_error && p.status !== "PUBLISHED" && (
                    <p className="mt-1 text-xs text-red-600">
                      {p.last_error}
                      {p.attempts > 1 ? ` · intento ${p.attempts}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {p.permalink && !p.deleted_at && (
                    <a
                      href={p.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      Ver post <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  <AccionesPost
                    id={p.id}
                    status={p.status}
                    platform={p.platform}
                    permalink={p.permalink}
                    deleted={!!p.deleted_at}
                    deleting={!!p.delete_requested_at && !p.deleted_at}
                    deleteFailed={!!p.delete_error}
                  />
                </div>
              </CardContent>
            </Card>
          )
        })
      )}
    </section>
  )

  return (
    <>
      <PageHeader
        title="Calendario"
        description={`${upcoming.length} por salir · ${published.length} publicados${problems.length ? ` · ${problems.length} con problemas` : ""}${brand ? ` · ${brand.name}` : ""}`}
      />
      <div className="space-y-8 p-4 md:p-6">
        {problems.length > 0 && section("Necesitan tu atención", problems, "")}
        {section("Por salir", upcoming, "Nada programado. Aprobá publicaciones en Aprobaciones.")}
        {section("Publicados", published, "Todavía no se publicó nada.")}
        <p className="text-center text-xs text-muted-foreground">
          ¿Falta algo? Revisá <Link href="/aprobaciones" className="text-primary hover:underline">Aprobaciones</Link>.
        </p>
      </div>
    </>
  )
}

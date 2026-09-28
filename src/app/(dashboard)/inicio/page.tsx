import Link from "next/link"
import Image from "next/image"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrls } from "@/lib/cos/storage"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CheckCircle, Images, CalendarClock, Zap, ArrowRight, Circle, Upload } from "lucide-react"

export const dynamic = "force-dynamic"

type AssetRow = {
  id: string
  description: string | null
  status: string
  quality_score: number | null
  thumb_key: string | null
  submitted_by_label: string | null
  created_at: string
  cos_brands: { name: string; color: string } | null
}

type WeekPost = { id: string; status: string; scheduled_at: string | null }

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  NEW: { label: "Nuevo", variant: "secondary" },
  VALIDATING: { label: "Procesando", variant: "secondary" },
  READY: { label: "Listo", variant: "default" },
  IN_USE: { label: "En uso", variant: "default" },
  MISSING_DESCRIPTION: { label: "Sin descripción", variant: "destructive" },
  FAILED_PROCESSING: { label: "Error", variant: "destructive" },
}

const AR = "America/Argentina/Buenos_Aires"
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: AR })

function ago(iso: string | null) {
  if (!iso) return "nunca"
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return "recién"
  if (min < 60) return `hace ${min} min`
  if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`
  return `hace ${Math.round(min / 1440)} días`
}

export default async function InicioPage() {
  const member = await requireMember("viewer")
  const brand = await getActiveBrand()
  const db = createAdminClient()
  // Filtro por marca en todas las consultas de contenido.
  const b = <Q,>(q: Q): Q => (brand ? (q as unknown as { eq: (c: string, v: string) => Q }).eq("brand_id", brand.id) : q)

  const now = new Date()
  const weekEnd = new Date(now.getTime() + 7 * 86_400_000)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [pending, scheduled, ready, processing, recent, week, accounts, archived, queued, failedJobs, aiMonth, settings] =
    await Promise.all([
      b(db.from("cos_posts").select("*", { count: "exact", head: true }).eq("status", "PENDING_APPROVAL")),
      b(db.from("cos_posts").select("*", { count: "exact", head: true }).in("status", ["SCHEDULED", "APPROVED", "RETRY_SCHEDULED"])),
      b(db.from("cos_assets").select("*", { count: "exact", head: true }).in("status", ["READY", "IN_USE"])),
      b(db.from("cos_assets").select("*", { count: "exact", head: true }).in("status", ["NEW", "VALIDATING"])),
      b(
        db
          .from("cos_assets")
          .select("id, description, status, quality_score, thumb_key, submitted_by_label, created_at, cos_brands(name, color)")
          .neq("status", "ARCHIVED")
          .order("created_at", { ascending: false })
          .limit(8),
      ),
      b(
        db
          .from("cos_posts")
          .select("id, status, scheduled_at")
          .eq("simulated", false)
          .gte("scheduled_at", new Date(now.getTime() - 86_400_000).toISOString())
          .lte("scheduled_at", weekEnd.toISOString())
          .in("status", ["SCHEDULED", "APPROVED", "PENDING_APPROVAL", "PUBLISHING", "PUBLISHED", "RETRY_SCHEDULED"])
          .order("scheduled_at"),
      ),
      b(db.from("cos_social_accounts").select("platform, status, last_checked_at").neq("status", "disabled")),
      b(db.from("cos_assets").select("*", { count: "exact", head: true }).not("drive_file_id", "is", null)),
      db.from("cos_jobs").select("*", { count: "exact", head: true }).in("status", ["queued", "running"]),
      db
        .from("cos_jobs")
        .select("*", { count: "exact", head: true })
        .eq("status", "failed")
        .gte("created_at", new Date(now.getTime() - 86_400_000).toISOString()),
      db.from("cos_ai_usage").select("*", { count: "exact", head: true }).gte("created_at", monthStart),
      db.from("cos_settings").select("publish_mode, global_pause, drive_root_id").eq("id", true).single(),
    ])

  const pendingCount = pending.count ?? 0
  const recentAssets = (recent.data ?? []) as unknown as AssetRow[]
  const weekPosts = (week.data ?? []) as WeekPost[]
  const accs = accounts.data ?? []
  const okAccs = accs.filter((a) => a.status === "connected").length
  const lastCheck = accs.map((a) => a.last_checked_at).filter(Boolean).sort().at(-1) ?? null
  const s = settings.data

  const thumbMap = await signedUrls(recentAssets.map((a) => a.thumb_key).filter(Boolean) as string[])

  const days = Array.from({ length: 7 }, (_, i) => new Date(now.getTime() + i * 86_400_000))
  const postsByDay = days.map((d) => weekPosts.filter((p) => p.scheduled_at && dayKey(new Date(p.scheduled_at)) === dayKey(d)))

  const hour = Number(now.toLocaleString("en-US", { timeZone: AR, hour: "numeric", hour12: false }))
  const greeting = hour < 13 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches"
  const who = member.displayName?.split(" ")[0] ?? "Javier"

  const health = [
    {
      label: "Instagram y Facebook",
      sub: accs.length ? `${okAccs} de ${accs.length} cuentas conectadas · revisado ${ago(lastCheck)}` : "sin cuentas",
      ok: accs.length > 0 && okAccs === accs.length,
    },
    {
      label: "Google Drive",
      sub: s?.drive_root_id ? `${archived.count ?? 0} originales guardados en Content OS` : "no conectado",
      ok: !!s?.drive_root_id,
    },
    {
      label: "Worker",
      sub: `${queued.count ?? 0} trabajos en cola${failedJobs.count ? ` · ${failedJobs.count} fallaron hoy` : ""}`,
      ok: !failedJobs.count,
    },
    {
      label: "Publicación",
      sub: s?.global_pause ? "en pausa: no sale nada" : s?.publish_mode === "live" ? "real, con tu aprobación" : "simulada",
      ok: !s?.global_pause && s?.publish_mode === "live",
    },
    { label: "IA este mes", sub: `${aiMonth.count ?? 0} análisis y textos`, ok: true },
  ]

  const stats = [
    { label: "Para aprobar", value: pendingCount, icon: CheckCircle, tone: "bg-amber-100 text-amber-600 dark:bg-amber-900/30", href: "/aprobaciones", cta: pendingCount ? "Revisar" : "Nada pendiente" },
    { label: "Programados", value: scheduled.count ?? 0, icon: CalendarClock, tone: "bg-blue-100 text-blue-600 dark:bg-blue-900/30", href: "/calendar", cta: "Ver calendario" },
    { label: "Listos para usar", value: ready.count ?? 0, icon: Images, tone: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30", href: "/media", cta: "Ir a biblioteca" },
    { label: "Procesando", value: processing.count ?? 0, icon: Zap, tone: "bg-violet-100 text-violet-600 dark:bg-violet-900/30", href: null, cta: processing.count ? "La IA los está mirando" : "Todo al día" },
  ]

  return (
    <>
      <div className="border-b bg-background px-6 py-5">
        <p className="mb-0.5 text-[12px] font-semibold uppercase tracking-widest text-muted-foreground">
          {now.toLocaleDateString("es-AR", { timeZone: AR, weekday: "long", day: "numeric", month: "long" })}
          {brand ? ` · ${brand.name}` : " · todas las marcas"}
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          {greeting}, {who}
        </h1>
      </div>

      <div className="space-y-6 p-6">
        {pendingCount > 0 && (
          <div className="flex flex-wrap items-center gap-4 rounded-[18px] bg-primary px-5 py-4 text-white shadow-md">
            <div className="min-w-[200px] flex-1">
              <p className="text-lg font-bold leading-tight" style={{ fontFamily: "var(--font-display)" }}>
                {pendingCount === 1 ? "1 post espera tu aprobación" : `${pendingCount} posts esperan tu aprobación`}
              </p>
              <p className="mt-0.5 text-sm opacity-90">Nada sale sin tu OK.</p>
            </div>
            <Button asChild variant="secondary" className="shrink-0 bg-white font-semibold text-primary hover:bg-white/90">
              <Link href="/aprobaciones">Revisar ahora</Link>
            </Button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          {stats.map((st) => (
            <Card key={st.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{st.label}</p>
                    <p className="mt-1 text-[34px] font-extrabold leading-none" style={{ fontFamily: "var(--font-display)" }}>
                      {st.value}
                    </p>
                  </div>
                  <div className={`rounded-xl p-2.5 ${st.tone}`}>
                    <st.icon className="h-5 w-5" />
                  </div>
                </div>
                {st.href ? (
                  <Link href={st.href} className="mt-3 flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    {st.cta} <ArrowRight className="h-3 w-3" />
                  </Link>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">{st.cta}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Esta semana</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/calendar">
                  Ver calendario <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-2">
                {days.map((d, i) => (
                  <div
                    key={i}
                    className={`flex min-h-[110px] flex-col gap-1.5 rounded-[12px] p-2 ${
                      i === 0 ? "bg-primary/5 outline outline-2 outline-offset-[-2px] outline-primary" : "bg-muted/50"
                    }`}
                  >
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {d.toLocaleDateString("es-AR", { timeZone: AR, weekday: "short" }).replace(".", "")}
                      </p>
                      <p className="text-lg font-bold leading-none" style={{ fontFamily: "var(--font-display)" }}>
                        {d.toLocaleDateString("es-AR", { timeZone: AR, day: "numeric" })}
                      </p>
                    </div>
                    {postsByDay[i].map((p) => {
                      const done = p.status === "PUBLISHED"
                      const approved = ["APPROVED", "SCHEDULED", "PUBLISHING", "RETRY_SCHEDULED"].includes(p.status)
                      return (
                        <div
                          key={p.id}
                          className={`flex items-center gap-1 rounded-[7px] bg-background px-1.5 py-1 text-[11px] font-semibold ${
                            done ? "text-muted-foreground" : approved ? "text-emerald-700" : "text-violet-700"
                          }`}
                        >
                          <Circle className="h-2 w-2 shrink-0 fill-current" />
                          {new Date(p.scheduled_at!).toLocaleTimeString("es-AR", { timeZone: AR, hour: "2-digit", minute: "2-digit", hour12: false })}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Cómo está todo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {health.map((h) => (
                  <div key={h.label} className="flex items-start gap-3 py-2.5 text-sm">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${h.ok ? "bg-emerald-500" : "bg-amber-500"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-tight">{h.label}</p>
                      <p className="text-xs text-muted-foreground">{h.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Recién llegado de la cocina</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/media">
                Ver biblioteca <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recentAssets.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <Upload className="h-9 w-9 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Todavía no llegó nada{brand ? ` de ${brand.name}` : ""}. Subí la primera foto como la mandaría un empleado.
                </p>
                <Button asChild>
                  <Link href="/media/subir">
                    <Upload className="h-4 w-4" /> Subir contenido
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                {recentAssets.map((a) => {
                  const thumb = a.thumb_key ? thumbMap[a.thumb_key] : null
                  const st = STATUS[a.status] ?? { label: a.status, variant: "secondary" as const }
                  return (
                    <Link
                      key={a.id}
                      href={`/composer?asset=${a.id}`}
                      className="group relative overflow-hidden rounded-xl border bg-muted/30 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
                    >
                      <div className="relative aspect-square">
                        {thumb ? (
                          <Image src={thumb} alt={a.description ?? ""} fill className="object-cover" sizes="140px" />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <Images className="h-6 w-6 text-muted-foreground/30" />
                          </div>
                        )}
                      </div>
                      <div className="space-y-1 p-1.5">
                        {a.cos_brands && (
                          <div className="flex items-center gap-1">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: a.cos_brands.color }} />
                            <span className="truncate text-[10px] text-muted-foreground">{a.cos_brands.name}</span>
                          </div>
                        )}
                        <Badge variant={st.variant} className="px-1 py-0 text-[9px]">
                          {st.label}
                        </Badge>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

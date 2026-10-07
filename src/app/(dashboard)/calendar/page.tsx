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
import { VistaMes } from "./mes"
import { AgregarFecha, BorrarFecha } from "./fechas"
import { isDeliveryDay, weatherText } from "../../../../shared/cos/special-days"

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
  schedule_source: string | null
  schedule_lock: boolean
  schedule_reason: string | null
  schedule_log: { de: string; a: string; porque: string; cuando: string }[] | null
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

/** Mes de hoy en Buenos Aires (fuera del componente: la hora actual no es "pura"). */
const mesActual = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7)

/** Mes (la grilla con la agenda y las campañas) o Lista (lo programado y publicado, con acciones). */
function Vistas({ actual }: { actual: "mes" | "lista" }) {
  return (
    <div className="flex gap-1 rounded-full border p-0.5 text-sm">
      {(
        [
          ["mes", "Mes", "/calendar"],
          ["lista", "Lista", "/calendar?vista=lista"],
        ] as const
      ).map(([id, label, href]) => (
        <Link key={id} href={href} className={`rounded-full px-3 py-1 font-semibold ${actual === id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
          {label}
        </Link>
      ))}
    </div>
  )
}

export default async function CalendarioPage({ searchParams }: { searchParams: Promise<{ vista?: string; mes?: string }> }) {
  await requireMember("viewer")
  const { vista, mes } = await searchParams
  if (vista === "lista") return <ListaCalendario />
  const hoy = mesActual()
  const elegido = mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? mes : hoy
  return (
    <>
      <PageHeader title="Calendario" description="La agenda mira 3 meses: lo que propone, lo aprobado y lo publicado, con las campañas de cada época">
        <Vistas actual="mes" />
      </PageHeader>
      <div className="p-4 md:p-6">
        <VistaMes mes={elegido} />
      </div>
    </>
  )
}

async function ListaCalendario() {
  const brand = await getActiveBrand()
  const db = createAdminClient()

  let query = db
    .from("cos_posts")
    .select(
      `id, caption, platform, post_type, status, scheduled_at, published_at, permalink, last_error, attempts,
       deleted_at, delete_requested_at, delete_error, schedule_source, schedule_lock, schedule_reason, schedule_log,
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

  // F4: clima de 7 días y fechas especiales de los próximos 30 (globales y de la marca).
  const today = new Date(new Date().getTime() - 3 * 3600_000).toISOString().slice(0, 10)
  const in30 = new Date(new Date().getTime() + 30 * 86_400_000).toISOString().slice(0, 10)
  let fq = db.from("cos_special_days").select("id, day, name, kind, source, hint, brand_id, cos_brands(name, color)").gte("day", today).lte("day", in30).order("day")
  fq = brand ? fq.or(`brand_id.is.null,brand_id.eq.${brand.id}`) : fq
  const [{ data: fechasRaw }, { data: clima }] = await Promise.all([fq, db.from("cos_weather_daily").select("day, code, tmax, tmin, rain_prob").gte("day", today).order("day").limit(7)])
  const fechas = (fechasRaw ?? []) as unknown as { id: string; day: string; name: string; kind: string; source: string; hint: string | null; cos_brands: { name: string; color: string } | null }[]
  const diaCorto = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
  const KIND: Record<string, string> = { feriado: "Feriado", puente: "Puente", especial: "Fecha especial", marca: "De la marca", evento: "Evento" }

  const thumbOf = (p: PostRow) => p.cos_post_media.find((m) => m.position === 0)?.cos_asset_versions?.cos_assets?.thumb_key ?? null
  const thumbs = await signedUrls(rows.map(thumbOf).filter(Boolean) as string[])

  // F8: de dónde salió el horario.
  const origen = (p: PostRow) =>
    p.schedule_lock || p.schedule_source === "manual"
      ? { label: "🔒 a mano", title: "Horario fijado a mano: la agenda no lo mueve" }
      : p.schedule_source === "exploracion"
        ? { label: "🧪 prueba", title: "Horario con poca historia: se prueba para seguir aprendiendo" }
        : p.schedule_source === "motor"
          ? { label: "⚙️ agenda", title: "Horario elegido por la agenda según tus métricas" }
          : p.schedule_source === "fijo"
            ? { label: "📌 día fijo", title: "Feriado o clima: el día es fijo" }
            : null

  // Plan de la semana del agente (F8), de la marca elegida.
  const { data: planes } = brand
    ? await db.from("cos_agenda_plans").select("nota, agente, created_at").eq("brand_id", brand.id).not("nota", "is", null).order("created_at", { ascending: false }).limit(1)
    : { data: [] }
  const plan = planes?.[0] as { nota: string; agente: string; created_at: string } | undefined

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
                    {origen(p) && (
                      <span title={origen(p)!.title} className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {origen(p)!.label}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm">{p.caption || (p.post_type === "story" ? "Historia (sin texto)" : "(sin texto)")}</p>
                  {p.schedule_reason && p.status !== "PUBLISHED" && p.schedule_source !== "manual" && (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{p.schedule_reason}</p>
                  )}
                  {!!p.schedule_log?.length && p.status !== "PUBLISHED" && (
                    <p className="mt-0.5 text-[11px] text-sky-700">
                      Movido por la agenda: antes {when(p.schedule_log[p.schedule_log.length - 1].de)}
                    </p>
                  )}
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
      >
        <Vistas actual="lista" />
      </PageHeader>
      <div className="space-y-8 p-4 md:p-6">
        {plan && (
          <section className="space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Plan de la semana</h2>
            <div className="whitespace-pre-line rounded-xl border bg-card px-4 py-3 text-sm">
              {plan.nota}
              <p className="mt-2 text-[11px] text-muted-foreground">Agenda · {when(plan.created_at)}</p>
            </div>
          </section>
        )}

        {(clima?.length ?? 0) > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Clima en Buenos Aires</h2>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {clima!.map((w) => {
                const deliv = isDeliveryDay(w)
                return (
                  <div key={w.day} className={`rounded-xl border p-2 text-center text-xs ${deliv ? "border-sky-300 bg-sky-50" : ""}`}>
                    <p className="font-semibold capitalize">{diaCorto(w.day)}</p>
                    <p className="text-muted-foreground">{weatherText(w.code)}</p>
                    <p className="font-bold">
                      {Math.round(Number(w.tmax))}° / {Math.round(Number(w.tmin))}°
                    </p>
                    <p className="text-muted-foreground">💧 {w.rain_prob ?? 0}%</p>
                    {deliv && <p className="mt-0.5 font-bold text-sky-700">día de delivery</p>}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Próximas fechas (30 días) <span className="font-normal">({fechas.length})</span>
            </h2>
            <AgregarFecha brandId={brand?.id ?? null} brandName={brand?.name ?? null} />
          </div>
          {fechas.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Sin fechas especiales en los próximos 30 días.</p>
          ) : (
            <div className="space-y-1.5">
              {fechas.map((f) => (
                <div key={f.id} className="flex items-start gap-3 rounded-xl border bg-card px-3 py-2 text-sm">
                  <span className="w-24 shrink-0 font-semibold capitalize">{diaCorto(f.day)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {f.name}{" "}
                      <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{KIND[f.kind] ?? f.kind}</span>
                      {f.cos_brands && (
                        <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: f.cos_brands.color }} />
                          {f.cos_brands.name}
                        </span>
                      )}
                    </p>
                    {f.hint && <p className="text-xs text-muted-foreground">Idea: {f.hint}</p>}
                  </div>
                  {f.source === "manual" && <BorrarFecha id={f.id} />}
                </div>
              ))}
            </div>
          )}
        </section>

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

import Image from "next/image"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrls } from "@/lib/cos/storage"
import { loadHolidays, loadMedia, modelFor, openDays, perfValue, type MediaRow } from "@/lib/cos/analytics"
import { PageHeader } from "@/components/dashboard/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PlatformIcon } from "@/components/ui/platform-icon"
import { explorationHint, lifts, liftText, suggestSlots, type Format } from "../../../../shared/cos/timing"
import { ExternalLink } from "lucide-react"

export const dynamic = "force-dynamic"

const AR = "America/Argentina/Buenos_Aires"
const FORMAT_LABEL: Record<string, string> = { feed: "Posts", reel: "Reels", story: "Historias", carousel: "Carruseles", video: "Videos" }
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
const HOURS = Array.from({ length: 15 }, (_, i) => i + 9) // 9 a 23
const n = (x: number) => x.toLocaleString("es-AR", { maximumFractionDigits: 0 })
const pct = (x: number) => `${(x * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`

function heatColor(v: number) {
  // 1 = neutro. Verde si rinde más, rojo si menos.
  const d = Math.max(-1, Math.min(1, (v - 1) / 0.6))
  return d >= 0 ? `rgba(16,185,129,${0.08 + d * 0.72})` : `rgba(239,68,68,${0.08 + -d * 0.55})`
}

export default async function MetricasPage() {
  await requireMember("viewer")
  const brand = await getActiveBrand()
  const db = createAdminClient()

  const [media, { data: accounts }, { data: daily }] = await Promise.all([
    loadMedia(db, { brandId: brand?.id, sinceDays: 365 }),
    (() => {
      let q = db
        .from("cos_social_accounts")
        .select("id, platform, display_name, brand_id, metrics_synced_at, metrics_error, metrics_backfill_done, cos_brands(name, color, rules_json)")
        .neq("status", "disabled")
      if (brand) q = q.eq("brand_id", brand.id)
      return q
    })(),
    db.from("cos_account_daily").select("account_id, day, followers").order("day", { ascending: false }).limit(500),
  ])

  type Acc = {
    id: string
    platform: string
    display_name: string
    brand_id: string
    metrics_synced_at: string | null
    metrics_error: string | null
    metrics_backfill_done: boolean
    cos_brands: { name: string; color: string; rules_json: { open_days?: string } | null } | null
  }
  const accs = (accounts ?? []) as unknown as Acc[]
  const ig = accs.filter((a) => a.platform === "instagram")

  const nowMs = new Date().getTime()
  const since30 = nowMs - 30 * 86_400_000
  const last30 = media.filter((m) => new Date(m.posted_at).getTime() >= since30)
  const reach30 = last30.reduce((s, m) => s + (m.metrics.reach ?? 0), 0)
  const inter30 = last30.reduce((s, m) => s + (m.metrics.total_interactions ?? 0), 0)
  const er30 = reach30 ? inter30 / reach30 : 0
  const followers = ig.map((a) => {
    const rows = (daily ?? []).filter((d) => d.account_id === a.id)
    const now = rows[0]?.followers ?? null
    const old = rows.find((d) => new Date(d.day).getTime() <= since30)?.followers ?? null
    return { a, now, delta: now != null && old != null ? now - old : null }
  })

  // Top publicaciones: rendimiento relativo a su cuenta y formato (no el alcance bruto).
  const perfByAccount = new Map<string, Map<string, number>>()
  for (const a of accs) {
    const mine = media.filter((m) => m.account_id === a.id && perfValue(m) > 0)
    const l = lifts(mine.map((m) => ({ postedAt: m.posted_at, format: m.format, reach: perfValue(m), id: m.id })))
    perfByAccount.set(a.id, new Map(l.map((x) => [x.post.id, x.lift])))
  }
  const liftOf = (m: MediaRow) => perfByAccount.get(m.account_id)?.get(m.id) ?? null
  const top = media
    .filter((m) => new Date(m.posted_at).getTime() >= nowMs - 90 * 86_400_000 && liftOf(m) != null)
    .sort((a, b) => (liftOf(b) ?? 0) - (liftOf(a) ?? 0))
    .slice(0, 12)
  const ours = media.filter((m) => m.post_id).slice(0, 12)
  const thumbs = await signedUrls([...top, ...ours].map((m) => m.thumb_key).filter(Boolean) as string[])

  const byFormat = (["feed", "carousel", "reel", "story", "video"] as Format[])
    .map((f) => {
      const xs = last30.filter((m) => m.format === f && perfValue(m) > 0)
      return { f, count: xs.length, avg: xs.length ? xs.reduce((s, m) => s + perfValue(m), 0) / xs.length : 0 }
    })
    .filter((x) => x.count)

  const brandAcc = brand ? ig[0] : null
  const holidays = await loadHolidays(db)
  const heat = brandAcc ? modelFor(media, brandAcc.id, "feed", holidays) : null
  const allowed = openDays(brandAcc?.cos_brands?.rules_json?.open_days)
  const explorar = heat ? explorationHint(heat.model) : null
  const ultima = media.find((m) => m.format !== "story")?.posted_at ?? null
  const bestByFormat = brandAcc
    ? (["feed", "reel", "story"] as Format[]).map((f) => {
        const { model, scope } = modelFor(media, brandAcc.id, f, holidays)
        return { f, scope, n: model.n, slots: model.n ? suggestSlots(model, { allowedDays: allowed, holidays }) : [] }
      })
    : []

  // F8 · Qué aprendió la agenda (última foto del modelo de la cuenta de Instagram de la marca).
  const FACTOR: Record<string, string> = { feriado: "Feriado", lluvia: "Lluvia", tormenta: "Tormenta", frio: "Frío", calor: "Calor", soleado: "Día soleado", nublado: "Nublado" }
  type EfectoRow = { factor: string; efecto: number; n: number; lo: number; hi: number; confianza: string; claro: boolean }
  const { data: fotoModelo } = brandAcc
    ? await db.from("cos_slot_models").select("format, n, model_json, computed_at").eq("account_id", brandAcc.id).order("computed_at", { ascending: false }).limit(6)
    : { data: [] }
  const modeloReciente = (fotoModelo ?? []).sort((a, b) => b.n - a.n)[0] as { format: string; n: number; model_json: { efectos: EfectoRow[]; peso: number }; computed_at: string } | undefined

  // F8 · ¿Acierta? Lo que predijo la agenda contra lo que rindió (a las 48 h o más).
  const { data: predichos } = brand
    ? await db
        .from("cos_posts")
        .select("id, predicted_lift, published_at, post_type, schedule_source")
        .eq("brand_id", brand.id)
        .eq("status", "PUBLISHED")
        .not("predicted_lift", "is", null)
        .lt("published_at", new Date(nowMs - 48 * 3600_000).toISOString())
        .order("published_at", { ascending: false })
        .limit(40)
    : { data: [] }
  const aciertos = (predichos ?? [])
    .map((p) => {
      const m = media.find((x) => x.post_id === p.id)
      const real = m ? liftOf(m) : null
      return real == null ? null : { id: p.id, predicho: Number(p.predicted_lift), real, fecha: p.published_at as string, tipo: p.post_type as string, prueba: p.schedule_source === "exploracion" }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
  const errorMedio = aciertos.length ? aciertos.reduce((s, a) => s + Math.abs(a.real - a.predicho), 0) / aciertos.length : null
  const mismoSentido = aciertos.filter((a) => (a.real >= 1) === (a.predicho >= 1)).length

  const card = (m: MediaRow) => {
    const t = m.thumb_key ? thumbs[m.thumb_key] : null
    const l = liftOf(m)
    return (
      <a
        key={m.id}
        href={m.permalink ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="group overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md"
      >
        <div className="relative aspect-square bg-muted">
          {t && <Image src={t} alt="" fill className="object-cover" sizes="160px" />}
          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            <PlatformIcon platform={m.platform} className="h-3 w-3" /> {FORMAT_LABEL[m.format]}
          </span>
        </div>
        <div className="space-y-0.5 p-2 text-[11px]">
          <p className={`font-bold ${l != null && l >= 1 ? "text-emerald-600" : "text-muted-foreground"}`}>{l != null ? liftText(l) : "—"}</p>
          <p className="text-muted-foreground">
            {n(perfValue(m))} {m.metrics.reach ? "alcance" : "vistas"} · {n(m.metrics.total_interactions ?? 0)} interacc.
          </p>
          <p className="flex items-center gap-1 text-muted-foreground">
            {new Date(m.posted_at).toLocaleDateString("es-AR", { timeZone: AR, day: "2-digit", month: "short" })}
            <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
          </p>
        </div>
      </a>
    )
  }

  return (
    <>
      <PageHeader title="Métricas" description={`${brand ? brand.name : "Todas las marcas"} · lo que funciona y cuándo publicar`} />
      <div className="space-y-6 p-4 md:p-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              l: "Publicaciones (30 días)",
              v: n(last30.length),
              s:
                !last30.length && ultima
                  ? `última: ${new Date(ultima).toLocaleDateString("es-AR", { timeZone: AR, day: "2-digit", month: "short", year: "numeric" })}`
                  : undefined,
            },
            { l: "Alcance (30 días)", v: n(reach30) },
            { l: "Tasa de interacción", v: reach30 ? pct(er30) : "—" },
            {
              l: followers.length > 1 ? `Seguidores Instagram (${followers.length} cuentas)` : "Seguidores Instagram",
              v: n(followers.reduce((s, x) => s + (x.now ?? 0), 0)),
              s: followers.some((x) => x.delta != null)
                ? `${followers.reduce((s, x) => s + (x.delta ?? 0), 0) >= 0 ? "+" : ""}${n(followers.reduce((s, x) => s + (x.delta ?? 0), 0))} en 30 días`
                : "la variación aparece a los 30 días de medir",
            },
          ].map((k) => (
            <Card key={k.l}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{k.l}</p>
                <p className="mt-1 text-[28px] font-extrabold leading-none" style={{ fontFamily: "var(--font-display)" }}>
                  {k.v}
                </p>
                {"s" in k && k.s && <p className="mt-1.5 text-[11px] text-muted-foreground">{k.s}</p>}
              </CardContent>
            </Card>
          ))}
        </div>

        {byFormat.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Alcance promedio por formato (30 días)</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              {byFormat.map((x) => (
                <div key={x.f} className="rounded-xl bg-muted/60 px-4 py-2.5">
                  <p className="text-xs text-muted-foreground">
                    {FORMAT_LABEL[x.f]} · {x.count}
                  </p>
                  <p className="text-lg font-bold">{n(x.avg)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Cuándo publicar */}
        {!brand ? (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              Elegí una marca para ver sus mejores horarios y el mapa de calor por día y hora.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="min-w-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cuándo rinde más (Instagram, hora de Buenos Aires)</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Verde = más alcance que lo habitual de la cuenta; rojo = menos. Basado en {heat?.model.n ?? 0} publicaciones; las
                  franjas con pocos posts se apoyan en su hora y su día.
                </p>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {heat && heat.model.n > 0 ? (
                  <table className="w-full min-w-[560px] border-separate border-spacing-0.5 text-[10px]">
                    <thead>
                      <tr>
                        <th />
                        {HOURS.map((h) => (
                          <th key={h} className="font-medium text-muted-foreground">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                        <tr key={d}>
                          <td className="pr-1 font-semibold text-muted-foreground">{DIAS[d]}</td>
                          {HOURS.map((h) => (
                            <td
                              key={h}
                              title={`${DIAS[d]} ${h}:00 · ${liftText(heat.model.grid[d][h])} · ${heat.model.count[d][h]} posts`}
                              className="h-6 rounded text-center font-semibold"
                              style={{ background: heatColor(heat.model.grid[d][h]) }}
                            >
                              {heat.model.count[d][h] || ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-muted-foreground">Todavía no hay métricas de esta cuenta. Se juntan solas cada 2 horas.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Próximos mejores horarios</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {explorar?.concentrada && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Casi siempre publicaron a las {explorar.habitual.map((h) => `${h}:00`).join(" y ")}: se pueden comparar los días, pero no
                    los horarios. Para descubrir si otra hora rinde más, probá de vez en cuando
                    {explorar.probar.length ? ` las ${explorar.probar.map((h) => `${h}:00`).join(", ")}` : " otras horas"}.
                  </p>
                )}
                {bestByFormat.map((b) => (
                  <div key={b.f}>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {FORMAT_LABEL[b.f]}
                      {b.scope === "cuenta" && b.n > 0 && <span className="font-normal normal-case"> · con datos de toda la cuenta</span>}
                    </p>
                    {b.slots.length ? (
                      <ul className="mt-1 space-y-1">
                        {b.slots.map((s) => (
                          <li key={s.at} className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-1.5 text-sm">
                            <span className="capitalize">{s.label}</span>
                            <span className={`text-xs font-bold ${s.lift >= 1 ? "text-emerald-600" : "text-muted-foreground"}`}>
                              {liftText(s.lift)}
                              <span className="ml-1 font-normal text-muted-foreground">· confianza {s.confianza}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">Todavía poca data para recomendar.</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lo que mejor funcionó (90 días)</CardTitle>
            <p className="text-xs text-muted-foreground">Ordenado por rendimiento contra lo habitual de su cuenta y formato.</p>
          </CardHeader>
          <CardContent>
            {top.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">{top.map(card)}</div>
            ) : (
              <p className="text-sm text-muted-foreground">Sin publicaciones medidas en los últimos 90 días.</p>
            )}
          </CardContent>
        </Card>

        {brand && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Qué aprendió la agenda</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!modeloReciente ? (
                <p className="text-muted-foreground">Todavía no hay modelo guardado: se calcula una vez por día.</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Cuánto cambian el rendimiento los feriados y el clima, descontando el horario. Con {modeloReciente.n} publicaciones propias
                    ({Math.round(modeloReciente.model_json.peso * 100)} % propio, el resto aprendido de todas las cuentas). Solo se usa lo que tiene efecto claro.
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {modeloReciente.model_json.efectos.map((e) => (
                      <div key={e.factor} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
                        <span className="flex-1">{FACTOR[e.factor] ?? e.factor}</span>
                        <span className={e.claro ? (e.efecto >= 1 ? "font-bold text-emerald-600" : "font-bold text-red-600") : "text-muted-foreground"}>
                          {e.claro ? liftText(e.efecto) : "sin efecto claro"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {e.n} posts · {e.confianza}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {brand && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">¿La agenda acierta?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {aciertos.length === 0 ? (
                <p className="text-muted-foreground">Todavía no hay publicaciones de la agenda con más de 48 h. Cada una guarda lo que se esperaba y acá se compara con lo que rindió.</p>
              ) : (
                <>
                  <p>
                    Acertó si iba a rendir más o menos que el promedio en <b>{mismoSentido} de {aciertos.length}</b>
                    {errorMedio != null && <> · error medio {Math.round(errorMedio * 100)} puntos</>}.
                  </p>
                  <div className="divide-y text-xs">
                    {aciertos.slice(0, 10).map((a) => (
                      <div key={a.id} className="flex items-center gap-2 py-1.5">
                        <span className="w-24 text-muted-foreground">{new Date(a.fecha).toLocaleDateString("es-AR", { timeZone: AR, day: "2-digit", month: "short" })}</span>
                        <span className="w-16">{FORMAT_LABEL[a.tipo] ?? a.tipo}{a.prueba ? " 🧪" : ""}</span>
                        <span className="flex-1">esperado {liftText(a.predicho)}</span>
                        <span className={a.real >= 1 ? "font-bold text-emerald-600" : "font-bold text-muted-foreground"}>real {liftText(a.real)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {ours.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Publicado con Content OS</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">{ours.map(card)}</div>
            </CardContent>
          </Card>
        )}

        {/* Salud de la recolección */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recolección de métricas</CardTitle>
          </CardHeader>
          <CardContent className="divide-y text-sm">
            {accs.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 py-2">
                <PlatformIcon platform={a.platform} className="h-4 w-4" />
                <span className="font-medium">{a.display_name}</span>
                <span className="text-xs text-muted-foreground">
                  {a.metrics_synced_at
                    ? `actualizado ${new Date(a.metrics_synced_at).toLocaleString("es-AR", { timeZone: AR, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
                    : "todavía sin sincronizar"}
                  {a.metrics_synced_at && !a.metrics_backfill_done ? " · trayendo el histórico…" : ""}
                </span>
                {a.metrics_error && <span className="w-full text-xs text-red-600">{a.metrics_error}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

import Link from "next/link"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { createAdminClient } from "@/lib/supabase/admin"
import { PageHeader } from "@/components/dashboard/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { MetricasTabs } from "../tabs"
import { SugerenciasSemana, type Sugerencia } from "./sugerencias"
import { signedUrls } from "@/lib/cos/storage"
import type { EfectoRasgo, Objetivo } from "../../../../../shared/cos/taste"

export const dynamic = "force-dynamic"

/**
 * F7 · Gustos (M1, solo lectura): qué rasgos le gustan al público de la marca, medido descontando el
 * horario. Nada de esto elige todavía: sirve para ver qué aprende el motor antes de dejarlo elegir.
 */
const OBJ: Record<Objetivo, { label: string; ayuda: string }> = {
  gusta: { label: "Gusta", ayuda: "vistas + interacción + retención" },
  crece: { label: "Crece", ayuda: "seguidores ganados + visitas al perfil" },
  conversa: { label: "Conversa", ayuda: "comentarios + respuestas + compartidos" },
}
const FORMATO: Record<string, string> = { feed: "Posts", reel: "Reels", story: "Historias", carousel: "Carruseles", video: "Videos" }
const CAMPO: Record<string, string> = {
  plano: "Plano", protagonista: "Protagonista", accion: "Acción", luz_temp: "Luz", luz_nivel: "Luz", fondo: "Fondo",
  genero: "Música: género", mood: "Música: mood", voz: "Música: voz", bpm: "Música: ritmo", energia: "Música: energía",
  plantilla: "Plantilla", frase: "Frase", musica: "Música", clima: "Clima", feriado: "Feriado",
}
const VALOR: Record<string, string> = {
  primer_plano: "primer plano", cenital: "cenital (desde arriba)", medio: "plano medio", ambiente: "ambiente",
  producto: "el producto", manos_proceso: "manos / proceso", persona: "personas", local: "el local", placa: "placa gráfica",
  vapor: "vapor", corte: "corte", armado: "armado", salsa: "salsa", servido: "servido", nada: "quieto",
  calida: "cálida", fria: "fría", clara: "clara", oscura: "oscura", limpio: "limpio", cargado: "cargado",
  con_voz: "con voz", instrumental: "instrumental", lento: "lento", rapido: "rápido", baja: "baja", alta: "alta",
  con_frase: "con frase", sin_frase: "sin frase", con_musica: "con música", sin_musica: "sin música", si: "sí",
}
const pct = (x: number) => {
  const p = Math.round((x - 1) * 100)
  return Math.abs(p) < 3 ? "como siempre" : `${p > 0 ? "+" : "−"}${Math.abs(p)} %`
}

type Modelo = {
  format: string
  objective: Objetivo
  n: number
  computed_at: string
  model_json: {
    efectos: EfectoRasgo[]
    ridge: { coef: Record<string, number>; n: number } | null
    temas: { track_id: string; titulo: string; activo: boolean; efecto: number; heredado: number; n: number }[]
    backtest: { meses: number; n: number; errorModelo: number; errorBase: number; gana: boolean } | null
    con_rasgos: number
  }
}

/** Días desde una fecha (fuera del componente: la hora actual no es "pura"). */
function diasDesde(iso: string) {
  return (Date.now() - Date.parse(iso)) / 86_400_000
}

/** Barra centrada en "como siempre": verde a la derecha, roja a la izquierda, con el intervalo. */
function Barra({ e }: { e: EfectoRasgo }) {
  const x = (v: number) => Math.max(0, Math.min(100, 50 + Math.log(v) * 70))
  return (
    <div className="relative h-3 w-full rounded-full bg-muted">
      <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/30" />
      <div className="absolute inset-y-1 rounded-full bg-foreground/15" style={{ left: `${x(e.lo)}%`, width: `${Math.max(1, x(e.hi) - x(e.lo))}%` }} />
      <div
        className={cn("absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full", e.claro ? (e.efecto >= 1 ? "bg-emerald-600" : "bg-red-600") : "bg-muted-foreground")}
        style={{ left: `${x(e.efecto)}%` }}
      />
    </div>
  )
}

export default async function GustosPage({ searchParams }: { searchParams: Promise<{ objetivo?: string }> }) {
  await requireMember("viewer")
  const brand = await getActiveBrand()
  const pedido = (await searchParams).objetivo
  const objetivo: Objetivo = (["gusta", "crece", "conversa"] as const).find((o) => o === pedido) ?? "gusta"
  const db = createAdminClient()

  if (!brand) {
    return (
      <>
        <PageHeader title="Gustos" description="Qué le gusta al público de cada marca" />
        <div className="space-y-4 p-4 md:p-6">
          <MetricasTabs activa="gustos" />
          <p className="rounded-xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">Elegí una marca arriba para ver sus gustos.</p>
        </div>
      </>
    )
  }

  const { data } = await db
    .from("cos_taste_models")
    .select("format, objective, n, computed_at, model_json")
    .eq("brand_id", brand.id)
    .order("computed_at", { ascending: false })
    .limit(60)
  const todos = (data ?? []) as unknown as Modelo[]
  // La foto más reciente de cada formato para el objetivo elegido, y la de hace ~un mes para comparar.
  const ultimo = new Map<string, Modelo>()
  const haceUnMes = new Map<string, Modelo>()
  for (const m of todos.filter((x) => x.objective === objetivo)) {
    if (!ultimo.has(m.format)) ultimo.set(m.format, m)
    const dias = diasDesde(m.computed_at)
    if (dias >= 25 && dias <= 45 && !haceUnMes.has(m.format)) haceUnMes.set(m.format, m)
  }
  const { data: usosRecientes } = await db.from("cos_posts").select("music_track_id").eq("brand_id", brand.id).not("music_track_id", "is", null).order("created_at", { ascending: false }).limit(10)
  const usos = new Map<string, number>()
  for (const u of usosRecientes ?? []) usos.set(u.music_track_id as string, (usos.get(u.music_track_id as string) ?? 0) + 1)

  // Sugerencias de la semana más reciente (F7 M3).
  const { data: sugRaw } = await db.from("cos_suggestions").select("id, kind, items_json, feedback, week").eq("brand_id", brand.id).order("week", { ascending: false }).limit(4)
  const semana = (sugRaw?.[0]?.week as string | undefined) ?? null
  const sugerencias: Sugerencia[] = (sugRaw ?? []).filter((x) => x.week === semana).map((x) => ({ id: x.id, kind: x.kind, items: x.items_json, feedback: x.feedback }))
  const idsPauta = ((sugerencias.find((x) => x.kind === "pauta")?.items as { media_id: string }[] | undefined) ?? []).map((c) => c.media_id)
  const { data: thumbsPauta } = idsPauta.length ? await db.from("cos_media").select("id, thumb_key").in("id", idsPauta) : { data: [] }
  const firmadas = await signedUrls((thumbsPauta ?? []).map((t) => t.thumb_key).filter(Boolean) as string[])
  const thumbs = Object.fromEntries((thumbsPauta ?? []).map((t) => [t.id, t.thumb_key ? (firmadas[t.thumb_key] ?? null) : null]))

  return (
    <>
      <PageHeader title="Gustos" description={`${brand.name} · qué rasgos le gustan a tu público (descontando el horario)`} />
      <div className="space-y-6 p-4 md:p-6">
        <MetricasTabs activa="gustos" />
        <SugerenciasSemana semana={semana} sugerencias={sugerencias} thumbs={thumbs} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Objetivo</span>
          {(Object.keys(OBJ) as Objetivo[]).map((o) => (
            <Link
              key={o}
              href={`/analytics/gustos?objetivo=${o}`}
              className={cn("rounded-full border px-3 py-1 text-xs font-semibold", o === objetivo ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
              title={OBJ[o].ayuda}
            >
              {OBJ[o].label}
            </Link>
          ))}
          <span className="text-xs text-muted-foreground">{OBJ[objetivo].ayuda}</span>
        </div>

        {ultimo.size === 0 && (
          <p className="rounded-xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">
            Todavía no hay modelo de gustos para esta marca: se calcula una vez por día (hacen falta al menos 20 publicaciones medidas del formato).
          </p>
        )}

        {[...ultimo.values()].map((m) => {
          const ef = m.model_json.efectos.filter((e) => !e.campo.startsWith("music") && e.n >= 3)
          const claros = ef.filter((e) => e.claro)
          const previo = haceUnMes.get(m.format)
          const cambios = previo
            ? claros.filter((e) => {
                const antes = previo.model_json.efectos.find((x) => x.campo === e.campo && x.valor === e.valor)
                return !antes?.claro || Math.sign(antes.efecto - 1) !== Math.sign(e.efecto - 1)
              })
            : []
          const bt = m.model_json.backtest
          const temas = [...m.model_json.temas].sort((a, b) => b.efecto - a.efecto)
          return (
            <Card key={m.format}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-baseline gap-2 text-base">
                  {FORMATO[m.format] ?? m.format}
                  <span className="text-xs font-normal text-muted-foreground">
                    {m.n} publicaciones · {m.model_json.con_rasgos} con rasgos · actualizado {new Date(m.computed_at).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {bt && (
                  <p className={cn("rounded-lg px-3 py-2 text-xs", bt.gana ? "bg-emerald-50 text-emerald-800" : "bg-muted text-muted-foreground")}>
                    {bt.gana
                      ? `✓ Probado contra tu historial (${bt.n} publicaciones de los últimos ${bt.meses} meses): predice mejor que "lo de siempre". El motor puede elegir imágenes en este formato.`
                      : bt.n < 30
                        ? `Todavía poca historia para probar si predice (${bt.n} publicaciones): el motor NO elige imágenes en este formato (sí la música).`
                        : `Probado contra tu historial (${bt.n} publicaciones): todavía no predice mejor que "lo de siempre". El motor NO elige imágenes en este formato (sí la música).`}
                  </p>
                )}
                {claros.length === 0 ? (
                  <p className="text-muted-foreground">Todavía poca data: ningún rasgo cambia el rendimiento de forma clara.</p>
                ) : null}
                <div className="space-y-1.5">
                  {ef
                    .sort((a, b) => Number(b.claro) - Number(a.claro) || Math.abs(Math.log(b.efecto)) - Math.abs(Math.log(a.efecto)))
                    .slice(0, 14)
                    .map((e) => (
                      <div key={`${e.campo}=${e.valor}`} className="grid grid-cols-[minmax(0,1fr)_90px] items-center gap-x-3 gap-y-0.5 sm:grid-cols-[180px_minmax(0,1fr)_110px]">
                        <span className="min-w-0 break-words">
                          <span className="text-muted-foreground">{CAMPO[e.campo] ?? e.campo}:</span> {VALOR[e.valor] ?? e.valor}
                        </span>
                        <span className={cn("text-right text-xs sm:order-last", e.claro ? (e.efecto >= 1 ? "font-bold text-emerald-700" : "font-bold text-red-700") : "text-muted-foreground")}>
                          {e.claro ? pct(e.efecto) : "sin efecto claro"}
                        </span>
                        <div className="col-span-2 sm:col-span-1">
                          <Barra e={e} />
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {e.n} publicaciones · confianza {e.confianza}
                          </p>
                          {e.junto_con && (
                            <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
                              ⚠️ Va casi siempre con «{e.junto_con}»: puede ser eso lo que rinde.
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
                {m.model_json.ridge && (
                  <p className="text-xs text-muted-foreground">
                    Con {m.model_json.ridge.n} publicaciones se separan los rasgos que van juntos: los números de arriba ya son confiables aunque dos rasgos aparezcan siempre juntos.
                  </p>
                )}
                {cambios.length > 0 && (
                  <p className="text-xs">
                    <b>Cambió este mes:</b> {cambios.map((e) => `${VALOR[e.valor] ?? e.valor} ${pct(e.efecto)}`).join(" · ")}
                  </p>
                )}
                {temas.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Música</p>
                    <div className="grid gap-1 text-xs sm:grid-cols-2">
                      {temas.map((t) => (
                        <div key={t.track_id} className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5", !t.activo && "opacity-50")}>
                          <span className="min-w-0 flex-1 truncate capitalize">{t.titulo}</span>
                          <span className={t.efecto >= 1.03 ? "font-semibold text-emerald-700" : t.efecto <= 0.97 ? "font-semibold text-red-700" : "text-muted-foreground"}>{pct(t.efecto)}</span>
                          <span className="text-xs text-muted-foreground">{t.n ? `${t.n} usos` : "por sus rasgos"}</span>
                          {(usos.get(t.track_id) ?? 0) >= 3 && <span className="rounded bg-amber-100 px-1 text-xs text-amber-800">se usó mucho hace poco</span>}
                        </div>
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Un tema con pocos usos hereda lo que se sabe de sus rasgos (género, mood, ritmo, energía): marcá los chips en Marca → Motores → Sonido.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </>
  )
}

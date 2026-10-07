"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PlatformIcon } from "@/components/ui/platform-icon"
import { guardarRitmo } from "@/lib/cos/campanias-actions"
import { explicarError } from "@/lib/ui-errors"
import { cn } from "@/lib/utils"

export type PiezaDia = {
  id: string
  hora: string
  tipo: string
  plataforma: string
  estado: "propuesta" | "aprobada" | "publicada" | "problema" | "pausada"
  thumb: string | null
  texto: string
  porque: string | null
  permalink: string | null
  marca: { name: string; color: string } | null
}
export type DiaUI = {
  dia: string
  delMes: boolean
  piezas: PiezaDia[]
  fechas: { nombre: string; feriado: boolean }[]
  campanias: { id: string; nombre: string; color: string; inicia: boolean }[]
}

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
const TIPO: Record<string, string> = { feed: "Post", reel: "Reel", story: "Historia", carousel: "Carrusel" }
const ESTADO: Record<PiezaDia["estado"], { label: string; clase: string }> = {
  propuesta: { label: "Propuesta de la agenda (falta aprobar)", clase: "border-dashed border-muted-foreground/50 opacity-60" },
  aprobada: { label: "Aprobada: sale sola", clase: "border-sky-500" },
  publicada: { label: "Publicada", clase: "border-emerald-500" },
  pausada: { label: "En pausa", clase: "border-zinc-400 opacity-50" },
  problema: { label: "Con problema", clase: "border-red-500" },
}

const nombreMes = (mes: string) => new Date(`${mes}-15T12:00:00Z`).toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" })
const moverMes = (mes: string, n: number) => {
  const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}

export function MesClient(props: { mes: string; hoy: string; dias: DiaUI[]; marca: string | null; ritmo: { postsSemana: number; historiasDia: number } | null; sinHora: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [elegido, setElegido] = useState<string | null>(() => props.dias.find((d) => d.dia === props.hoy)?.dia ?? null)
  const [ritmo, setRitmo] = useState(props.ritmo)
  const dia = props.dias.find((d) => d.dia === elegido)
  const mesHoy = props.hoy.slice(0, 7)
  const cuenta = (e: PiezaDia["estado"]) => props.dias.filter((d) => d.delMes).reduce((n, d) => n + d.piezas.filter((p) => p.estado === e).length, 0)

  return (
    <div className="space-y-4">
      {/* Navegación: el mes y los dos siguientes (la agenda mira 90 días) */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/calendar?mes=${moverMes(props.mes, -1)}`} aria-label="Mes anterior" className="rounded-full border p-1.5 hover:bg-muted">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <h2 className="min-w-40 text-center text-lg font-semibold capitalize">{nombreMes(props.mes)}</h2>
        <Link href={`/calendar?mes=${moverMes(props.mes, 1)}`} aria-label="Mes siguiente" className="rounded-full border p-1.5 hover:bg-muted">
          <ChevronRight className="h-4 w-4" />
        </Link>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((n) => {
            const m = moverMes(mesHoy, n)
            return (
              <Link key={m} href={`/calendar?mes=${m}`} className={cn("rounded-full border px-3 py-1 text-xs font-semibold capitalize", m === props.mes ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
                {new Date(`${m}-15T12:00:00Z`).toLocaleDateString("es-AR", { month: "long", timeZone: "UTC" })}
              </Link>
            )
          })}
        </div>
        <div className="ml-auto flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>{cuenta("propuesta")} propuestas</span>
          <span>{cuenta("aprobada")} aprobadas</span>
          <span>{cuenta("publicada")} publicadas</span>
        </div>
      </div>

      {/* Ritmo de la marca: la agenda llena semana por semana con esto */}
      {ritmo && (
        <div className="flex flex-row flex-wrap items-center gap-3 rounded-xl border bg-card p-3 text-sm">
          <b>Ritmo de {props.marca}</b>
          <label className="flex items-center gap-1.5">
            <select className="rounded-md border bg-background px-2 py-1" value={ritmo.postsSemana} onChange={(e) => setRitmo({ ...ritmo, postsSemana: Number(e.target.value) })}>
              {[2, 3, 4, 5, 6, 7, 10, 14].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            posts o reels por semana
          </label>
          <label className="flex items-center gap-1.5">
            <select className="rounded-md border bg-background px-2 py-1" value={ritmo.historiasDia} onChange={(e) => setRitmo({ ...ritmo, historiasDia: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            historias por día
          </label>
          <span className="text-xs text-muted-foreground">por cuenta (Instagram y Facebook cada una), de 9 a 22</span>
          {(ritmo.postsSemana !== props.ritmo?.postsSemana || ritmo.historiasDia !== props.ritmo?.historiasDia) && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  try {
                    await guardarRitmo(ritmo.postsSemana, ritmo.historiasDia)
                    setMsg("Guardado: la agenda está reacomodando lo pendiente")
                    setTimeout(() => router.refresh(), 4000)
                  } catch (e) {
                    setMsg(explicarError(e))
                  }
                })
              }
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar y reacomodar
            </Button>
          )}
          {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
          {props.sinHora > 0 && (
            <span className="w-full text-xs text-amber-700">
              {props.sinHora} pieza{props.sinHora > 1 ? "s" : ""} pendiente{props.sinHora > 1 ? "s" : ""} sin lugar en los próximos 90 días con este ritmo: aprobá las mejores y rechazá el resto, o subí el ritmo.
            </span>
          )}
        </div>
      )}

      {/* Grilla del mes */}
      <div className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-7 gap-px overflow-hidden rounded-xl border bg-border">
          {DIAS.map((d) => (
            <div key={d} className="bg-muted/60 px-2 py-1.5 text-xs font-semibold text-muted-foreground">
              {d}
            </div>
          ))}
          {props.dias.map((d) => {
            const feriado = d.fechas.some((f) => f.feriado)
            return (
              <button
                key={d.dia}
                type="button"
                onClick={() => setElegido(d.dia)}
                className={cn("flex min-h-28 flex-col gap-1 bg-background p-1.5 text-left align-top transition-colors hover:bg-muted/40", !d.delMes && "bg-muted/30 text-muted-foreground", elegido === d.dia && "ring-2 ring-inset ring-primary")}
              >
                <div className="flex items-center justify-between">
                  <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", d.dia === props.hoy && "bg-primary text-primary-foreground", feriado && d.dia !== props.hoy && "text-red-600")}>
                    {Number(d.dia.slice(8))}
                  </span>
                  {d.piezas.length > 0 && <span className="text-[10px] text-muted-foreground">{d.piezas.length}</span>}
                </div>
                {d.campanias.map((c) => (
                  <span key={c.id} className="block h-4 truncate rounded px-1 text-[10px] font-semibold leading-4 text-white" style={{ backgroundColor: c.color }} title={c.nombre}>
                    {c.inicia ? c.nombre : " "}
                  </span>
                ))}
                {d.fechas.map((f) => (
                  <span key={f.nombre} className={cn("truncate text-[10px]", f.feriado ? "font-semibold text-red-600" : "text-muted-foreground")}>
                    {f.nombre}
                  </span>
                ))}
                <div className="mt-auto flex flex-wrap gap-1">
                  {d.piezas.slice(0, 6).map((p) => (
                    <span key={p.id} title={`${p.hora} · ${TIPO[p.tipo] ?? p.tipo} · ${ESTADO[p.estado].label}`} className={cn("relative h-7 w-7 overflow-hidden rounded border-2 bg-muted", ESTADO[p.estado].clase)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.thumb && <img src={p.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />}
                      {p.plataforma === "facebook" && <span className="absolute bottom-0 right-0 bg-[#1877f2] px-0.5 text-[7px] font-bold text-white">f</span>}
                    </span>
                  ))}
                  {d.piezas.length > 6 && <span className="text-[10px] text-muted-foreground">+{d.piezas.length - 6}</span>}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {(["propuesta", "aprobada", "publicada", "problema"] as const).map((e) => (
          <span key={e} className="flex items-center gap-1.5">
            <span className={cn("h-3.5 w-3.5 rounded border-2 bg-muted", ESTADO[e].clase)} /> {ESTADO[e].label}
          </span>
        ))}
      </div>

      {/* Detalle del día */}
      {dia && (
        <Card className="space-y-3 p-4">
          <h3 className="font-semibold capitalize">
            {new Date(`${dia.dia}T12:00:00Z`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
            {dia.campanias.length > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">· {dia.campanias.map((c) => c.nombre).join(" · ")}</span>}
          </h3>
          {dia.piezas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada programado este día.</p>
          ) : (
            <div className="space-y-2">
              {dia.piezas.map((p) => (
                <div key={p.id} className="flex items-start gap-3 rounded-lg border p-2">
                  <span className={cn("relative h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 bg-muted", ESTADO[p.estado].clase)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.thumb && <img src={p.thumb} alt="" className="h-full w-full object-cover" />}
                  </span>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                      <span className="tabular-nums">{p.hora}</span>
                      <PlatformIcon platform={p.plataforma as "instagram" | "facebook"} className="h-3.5 w-3.5" />
                      {TIPO[p.tipo] ?? p.tipo}
                      {p.marca && (
                        <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.marca.color }} />
                          {p.marca.name}
                        </span>
                      )}
                      <span className="text-xs font-normal text-muted-foreground">· {ESTADO[p.estado].label}</span>
                    </p>
                    {p.texto && <p className="truncate text-muted-foreground">{p.texto}</p>}
                    {p.porque && p.estado !== "publicada" && <p className="text-xs text-muted-foreground">{p.porque}</p>}
                  </div>
                  {p.estado === "propuesta" ? (
                    <Link href="/aprobaciones" className="shrink-0 text-xs font-semibold text-primary hover:underline">
                      Aprobar
                    </Link>
                  ) : p.permalink ? (
                    <a href={p.permalink} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Ver publicada">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

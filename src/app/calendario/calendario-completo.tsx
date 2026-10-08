"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Loader2, Search, SlidersHorizontal, Trash2, Undo2, X } from "lucide-react"
import { PlatformIcon } from "@/components/ui/platform-icon"
import { elegirMarca } from "@/lib/cos/brand-actions"
import { cancelarPost, pedirBorrado, volverAAprobacion } from "@/lib/cos/actions"
import { explicarError } from "@/lib/ui-errors"
import type { EstadoCal, FechaCal, PiezaCal } from "@/lib/cos/calendario-datos"
import type { Campania } from "../../../shared/cos/campanias"
import { RitmoMarca } from "../(dashboard)/calendar/ritmo-marca"
import { Campanias } from "../(dashboard)/calendar/campanias-client"
import { cn } from "@/lib/utils"

export type Vista = "dia" | "semana" | "mes"

const DIAS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"]
const TIPO: Record<string, string> = { feed: "Post", reel: "Reel", story: "Historia", carousel: "Carrusel" }
const ESTADO: Record<EstadoCal, { label: string; borde: string; extra?: string }> = {
  propuesta: { label: "Propuesta de la agenda (falta aprobar)", borde: "#9ca3af", extra: "border-dashed opacity-70" },
  aprobada: { label: "Aprobada: sale sola", borde: "#0ea5e9" },
  publicada: { label: "Publicada", borde: "#10b981" },
  pausada: { label: "En pausa", borde: "#a1a1aa", extra: "opacity-50" },
  problema: { label: "Con problema", borde: "#ef4444" },
}
const HORA_INI = 8
const HORA_FIN = 23
const ALTO_HORA = 64

const sumar = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const fmt = (dia: string, o: Intl.DateTimeFormatOptions) => new Date(`${dia}T12:00:00Z`).toLocaleDateString("es-AR", { ...o, timeZone: "UTC" })

type Props = {
  vista: Vista
  fecha: string
  hoy: string
  dias: string[]
  marca: { slug: string; name: string; color: string } | null
  marcas: { slug: string; name: string; color: string }[]
  piezas: PiezaCal[]
  fechas: FechaCal[]
  campanias: Campania[]
  ritmo: { postsSemana: number; historiasDia: number } | null
  sinHora: number
}

export function CalendarioCompleto(props: Props) {
  const router = useRouter()
  const [, start] = useTransition()
  const [redes, setRedes] = useState<Set<string>>(new Set(["instagram", "facebook"]))
  const [buscar, setBuscar] = useState("")
  const [elegida, setElegida] = useState<PiezaCal | null>(null)
  const [ajustes, setAjustes] = useState(false)

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return props.piezas.filter((p) => redes.has(p.plataforma) && (!q || p.texto.toLowerCase().includes(q)))
  }, [props.piezas, redes, buscar])
  const porDia = useMemo(() => {
    const m = new Map<string, PiezaCal[]>()
    for (const p of visibles) m.set(p.dia, [...(m.get(p.dia) ?? []), p])
    return m
  }, [visibles])
  const campDe = (dia: string) => props.campanias.filter((c) => c.activa && c.desde <= dia && dia <= c.hasta)
  const fechasDe = (dia: string) => props.fechas.filter((f) => f.dia === dia)

  const ir = (vista: Vista, fecha: string) => `/calendario?vista=${vista}&fecha=${fecha}`
  const paso = (n: number) => {
    if (props.vista === "dia") return sumar(props.fecha, n)
    if (props.vista === "semana") return sumar(props.fecha, 7 * n)
    const d = new Date(Date.UTC(Number(props.fecha.slice(0, 4)), Number(props.fecha.slice(5, 7)) - 1 + n, 1))
    return d.toISOString().slice(0, 10)
  }
  const titulo =
    props.vista === "mes"
      ? fmt(props.fecha, { month: "short", year: "numeric" })
      : props.vista === "semana"
        ? `${fmt(props.dias[0], { day: "numeric", month: "short" })} – ${fmt(props.dias[6], { day: "numeric", month: "short", year: "numeric" })}`
        : fmt(props.fecha, { weekday: "long", day: "numeric", month: "long", year: "numeric" })

  const toggleRed = (r: string) =>
    setRedes((s) => {
      const n = new Set(s)
      if (n.has(r) && n.size > 1) n.delete(r)
      else n.add(r)
      return n
    })

  return (
    <div className="flex h-screen flex-col bg-[#f4f5f7] text-[#1f2937]">
      {/* Barra de arriba: marca, redes, búsqueda, ajustes */}
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-8">
        <Link href="/calendar" className="rounded-full p-2 text-gray-500 hover:bg-white" aria-label="Volver al panel" title="Volver al panel">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <select
          aria-label="Marca"
          className="rounded-full border bg-white px-3 py-1.5 text-sm font-semibold shadow-sm"
          value={props.marca?.slug ?? ""}
          onChange={(e) => start(async () => {
            await elegirMarca(e.target.value)
            router.refresh()
          })}
        >
          <option value="">Todas las marcas</option>
          {props.marcas.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1.5">
          {(["facebook", "instagram"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => toggleRed(r)}
              aria-pressed={redes.has(r)}
              title={redes.has(r) ? `Ocultar ${r}` : `Mostrar ${r}`}
              className={cn("flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm transition", !redes.has(r) && "opacity-35 grayscale")}
            >
              <PlatformIcon platform={r} className="h-5 w-5" />
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm shadow-sm">
            <Search className="h-4 w-4 text-gray-400" />
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar publicaciones" className="w-44 bg-transparent outline-none placeholder:text-gray-400" />
          </label>
          {props.marca && (
            <button type="button" onClick={() => setAjustes(true)} className="rounded-xl bg-white p-2.5 shadow-sm hover:bg-gray-50" aria-label="Ritmo y campañas" title="Ritmo y campañas">
              <SlidersHorizontal className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* Calendario */}
      <div className="mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sm md:mx-8">
        <div className="flex flex-wrap items-center gap-3 bg-[#e9ebef] px-4 py-2.5">
          <nav className="flex gap-5 text-sm font-medium">
            {(["dia", "semana", "mes"] as const).map((v) => (
              <Link key={v} href={ir(v, props.fecha)} className={cn("border-b-2 pb-1", props.vista === v ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-600 hover:text-gray-900")}>
                {v === "dia" ? "Día" : v === "semana" ? "Semana" : "Mes"}
              </Link>
            ))}
          </nav>
          <div className="mx-auto flex items-center gap-3">
            <Link href={ir(props.vista, paso(-1))} aria-label="Anterior" className="rounded-full p-1 hover:bg-white">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <span className="min-w-40 text-center font-semibold capitalize">{titulo}</span>
            <Link href={ir(props.vista, paso(1))} aria-label="Siguiente" className="rounded-full p-1 hover:bg-white">
              <ChevronRight className="h-5 w-5" />
            </Link>
            <Link href={ir(props.vista, props.hoy)} className="rounded-full border border-gray-300 bg-white px-3 py-0.5 text-xs font-semibold hover:bg-gray-50">
              Hoy
            </Link>
          </div>
          <div className="hidden items-center gap-3 text-[11px] text-gray-500 lg:flex">
            {(["propuesta", "aprobada", "publicada"] as const).map((e) => (
              <span key={e} className="flex items-center gap-1">
                <span className={cn("h-3 w-3 rounded-sm border-2 bg-white", ESTADO[e].extra)} style={{ borderColor: ESTADO[e].borde }} />
                {e === "propuesta" ? "Propuesta" : e === "aprobada" ? "Aprobada" : "Publicada"}
              </span>
            ))}
          </div>
        </div>

        {props.vista === "mes" ? (
          <VistaMes {...props} porDia={porDia} campDe={campDe} fechasDe={fechasDe} onElegir={setElegida} ir={ir} />
        ) : (
          <VistaHoras {...props} porDia={porDia} campDe={campDe} fechasDe={fechasDe} onElegir={setElegida} />
        )}
      </div>

      {/* Detalle de una pieza */}
      {elegida && <Detalle p={elegida} onCerrar={() => setElegida(null)} />}

      {/* Ritmo y campañas */}
      {ajustes && props.marca && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => setAjustes(false)}>
          <div className="h-full w-full max-w-2xl space-y-4 overflow-y-auto bg-[#f4f5f7] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Ritmo y campañas de {props.marca.name}</h2>
              <button type="button" onClick={() => setAjustes(false)} aria-label="Cerrar" className="rounded-full p-1.5 hover:bg-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            {props.ritmo && <RitmoMarca marca={props.marca.name} ritmo={props.ritmo} sinHora={props.sinHora} />}
            <Campanias campanias={props.campanias} hoy={props.hoy} />
          </div>
        </div>
      )}
    </div>
  )
}

type VistaProps = Props & {
  porDia: Map<string, PiezaCal[]>
  campDe: (d: string) => Campania[]
  fechasDe: (d: string) => FechaCal[]
  onElegir: (p: PiezaCal) => void
}

/** Una pieza en la grilla: miniatura, hora, red y tipo; el borde dice el estado. */
function Chip({ p, onElegir, grande = false }: { p: PiezaCal; onElegir: (p: PiezaCal) => void; grande?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onElegir(p)
      }}
      title={`${p.hora} · ${TIPO[p.tipo] ?? p.tipo} · ${ESTADO[p.estado].label}`}
      className={cn("flex w-full items-center gap-1.5 overflow-hidden rounded-md border border-l-4 bg-white text-left shadow-sm transition hover:shadow", grande ? "p-1.5" : "px-1 py-0.5", ESTADO[p.estado].extra)}
      style={{ borderLeftColor: ESTADO[p.estado].borde }}
    >
      <span className={cn("shrink-0 overflow-hidden rounded bg-gray-100", grande ? "h-10 w-10" : "h-5 w-5")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.thumb && <img src={p.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />}
      </span>
      <span className={cn("shrink-0 tabular-nums text-gray-500", grande ? "text-xs" : "text-[10px]")}>{p.hora}</span>
      <PlatformIcon platform={p.plataforma as "instagram" | "facebook"} className="h-3 w-3 shrink-0" />
      <span className={cn("truncate font-medium", grande ? "text-sm" : "text-[11px]")}>{grande && p.texto ? p.texto.split("\n")[0] : (TIPO[p.tipo] ?? p.tipo)}</span>
      {p.marca && <span className="ml-auto h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.marca.color }} />}
    </button>
  )
}

function VistaMes(props: VistaProps & { ir: (v: Vista, f: string) => string }) {
  const mes = props.fecha.slice(0, 7)
  const semanas = Math.ceil(props.dias.length / 7)
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="grid min-w-[840px] grid-cols-7 border-b">
        {DIAS.map((d) => (
          <div key={d} className="border-r py-3 text-center text-sm font-medium text-gray-700 last:border-r-0">
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-w-[840px] flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${semanas}, minmax(150px, 1fr))` }}>
        {props.dias.map((d) => {
          const piezas = props.porDia.get(d) ?? []
          const fuera = d.slice(0, 7) !== mes
          const pasado = d < props.hoy
          return (
            <div key={d} className={cn("flex min-w-0 flex-col gap-1 border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0", (fuera || pasado) && "bg-[#f8f9fb]")}>
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0 space-y-0.5">
                  {props.fechasDe(d).map((f) => (
                    <p key={f.nombre} className={cn("truncate text-[10px]", f.feriado ? "font-semibold text-red-600" : "text-gray-500")}>
                      {f.nombre}
                    </p>
                  ))}
                </div>
                <Link href={props.ir("dia", d)} className={cn("shrink-0 text-sm tabular-nums hover:underline", d === props.hoy ? "font-bold text-emerald-600" : fuera ? "text-gray-400" : "text-gray-500")}>
                  {d.slice(8)}
                </Link>
              </div>
              {props.campDe(d).map((c) => (
                <span key={c.id} className="block h-1.5 rounded-full" style={{ backgroundColor: c.color }} title={c.nombre} />
              ))}
              <div className="flex min-w-0 flex-col gap-0.5">
                {piezas.slice(0, 4).map((p) => (
                  <Chip key={p.id} p={p} onElegir={props.onElegir} />
                ))}
                {piezas.length > 4 && (
                  <Link href={props.ir("dia", d)} className="px-1 text-[11px] font-medium text-emerald-700 hover:underline">
                    +{piezas.length - 4} más
                  </Link>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {/* Campañas del mes, con su color */}
      {props.campanias.some((c) => c.activa && c.desde <= props.dias[props.dias.length - 1] && c.hasta >= props.dias[0]) && (
        <div className="flex flex-wrap gap-3 border-t px-4 py-2 text-xs text-gray-600">
          {props.campanias
            .filter((c) => c.activa && c.desde <= props.dias[props.dias.length - 1] && c.hasta >= props.dias[0])
            .map((c) => (
              <span key={c.id} className="flex items-center gap-1.5">
                <span className="h-2 w-5 rounded-full" style={{ backgroundColor: c.color }} /> {c.nombre}
              </span>
            ))}
        </div>
      )}
    </div>
  )
}

/** Semana o día: columnas por día y filas por hora (de 8 a 23), cada pieza en su hora. */
function VistaHoras(props: VistaProps) {
  const horas = Array.from({ length: HORA_FIN - HORA_INI }, (_, i) => HORA_INI + i)
  const ancho = props.dias.length === 1 ? "grid-cols-[64px_1fr]" : "grid-cols-[64px_repeat(7,minmax(120px,1fr))]"
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className={cn("sticky top-0 z-10 grid border-b bg-white", ancho)}>
        <div />
        {props.dias.map((d) => (
          <div key={d} className="space-y-1 border-l px-2 py-2 text-center">
            <p className="text-xs font-medium text-gray-500">{DIAS[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7]}</p>
            <p className={cn("text-lg tabular-nums", d === props.hoy ? "font-bold text-emerald-600" : "text-gray-700")}>{d.slice(8)}</p>
            {props.campDe(d).map((c) => (
              <span key={c.id} className="block truncate rounded px-1 text-[10px] font-semibold text-white" style={{ backgroundColor: c.color }}>
                {c.nombre}
              </span>
            ))}
            {props.fechasDe(d).map((f) => (
              <p key={f.nombre} className={cn("truncate text-[10px]", f.feriado ? "font-semibold text-red-600" : "text-gray-500")}>
                {f.nombre}
              </p>
            ))}
          </div>
        ))}
      </div>
      <div className={cn("relative grid", ancho)}>
        <div>
          {horas.map((h) => (
            <div key={h} className="pr-2 text-right text-[11px] text-gray-400" style={{ height: ALTO_HORA }}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {props.dias.map((d) => {
          const piezas = props.porDia.get(d) ?? []
          // Las que caen en la misma hora se reparten el ancho.
          const porHora = new Map<number, PiezaCal[]>()
          for (const p of piezas) {
            const h = Math.min(HORA_FIN - 1, Math.max(HORA_INI, Math.floor(p.minutos / 60)))
            porHora.set(h, [...(porHora.get(h) ?? []), p])
          }
          return (
            <div key={d} className={cn("relative border-l", d < props.hoy && "bg-[#f8f9fb]")} style={{ height: horas.length * ALTO_HORA }}>
              {horas.map((h) => (
                <div key={h} className="border-b border-gray-100" style={{ height: ALTO_HORA }} />
              ))}
              {[...porHora.entries()].flatMap(([h, lista]) =>
                lista.map((p, i) => {
                  const top = (Math.max(HORA_INI * 60, Math.min((HORA_FIN - 1) * 60, p.minutos)) - HORA_INI * 60) * (ALTO_HORA / 60)
                  return (
                    <div key={p.id} className="absolute px-0.5" style={{ top: top + 2, left: `${(i / lista.length) * 100}%`, width: `${100 / lista.length}%`, zIndex: 1 + i + h }}>
                      <Chip p={p} onElegir={props.onElegir} grande={props.dias.length === 1} />
                    </div>
                  )
                }),
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Lo que se puede hacer con la pieza desde el calendario:
 *   propuesta → descartarla (no sale)
 *   aprobada / en pausa / con problema → volver a Aprobaciones (sin hora) o cancelarla
 *   publicada → borrarla de la red (el worker la baja de Instagram o Facebook)
 */
function Acciones({ p, onListo }: { p: PiezaCal; onListo: () => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const red = p.plataforma === "instagram" ? "Instagram" : "Facebook"
  const run = (pregunta: string, fn: () => Promise<void>, refrescos: number[] = []) => {
    if (!confirm(pregunta)) return
    setError(null)
    start(async () => {
      try {
        await fn()
        router.refresh()
        for (const ms of refrescos) {
          await new Promise((r) => setTimeout(r, ms))
          router.refresh()
        }
        onListo()
      } catch (e) {
        setError(explicarError(e))
      }
    })
  }
  const boton = "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"
  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap gap-2">
        {p.estado === "propuesta" && (
          <button type="button" disabled={pending} className={cn(boton, "border-red-200 text-red-700 hover:bg-red-50")} onClick={() => run("¿Descartar esta pieza? No va a salir y deja de estar en Aprobaciones.", () => cancelarPost(p.id))}>
            <Trash2 className="h-4 w-4" /> Descartar
          </button>
        )}
        {["aprobada", "pausada", "problema"].includes(p.estado) && (
          <>
            <button type="button" disabled={pending} className={cn(boton, "hover:bg-gray-50")} onClick={() => run("¿Sacarla del calendario? Vuelve a Aprobaciones sin hora, y la agenda le propone una nueva.", () => volverAAprobacion(p.id))}>
              <Undo2 className="h-4 w-4" /> Sacar del calendario y volver a aprobar
            </button>
            <button type="button" disabled={pending} className={cn(boton, "border-red-200 text-red-700 hover:bg-red-50")} onClick={() => run("¿Cancelar esta publicación? No va a salir.", () => cancelarPost(p.id))}>
              <Trash2 className="h-4 w-4" /> Cancelar
            </button>
          </>
        )}
        {p.estado === "publicada" &&
          (p.borrando ? (
            <span className="flex items-center gap-1.5 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Borrando de {red}…
            </span>
          ) : (
            <button
              type="button"
              disabled={pending}
              className={cn(boton, "border-red-200 text-red-700 hover:bg-red-50")}
              onClick={() => run(`¿Borrar esta publicación de ${red}? La gente ya no la va a ver. No se puede deshacer.`, () => pedirBorrado(p.id), [3000, 5000])}
            >
              <Trash2 className="h-4 w-4" /> {p.borrarError ? "Reintentar el borrado" : `Borrar de ${red}`}
            </button>
          ))}
        {pending && <Loader2 className="h-4 w-4 animate-spin self-center text-gray-400" />}
      </div>
      {p.borrarError && <p className="text-xs text-red-600">No se pudo borrar: {p.borrarError}. Probá de nuevo o borrala desde la app.</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

function Detalle({ p, onCerrar }: { p: PiezaCal; onCerrar: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/20" onClick={onCerrar}>
      <aside className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="flex items-center gap-2 font-semibold">
            <PlatformIcon platform={p.plataforma as "instagram" | "facebook"} className="h-4 w-4" />
            {TIPO[p.tipo] ?? p.tipo} · {fmt(p.dia, { weekday: "short", day: "numeric", month: "short" })} {p.hora}
          </p>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded-full p-1.5 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        {p.video ? (
          // La pieza final tal cual va a salir: con controles y sonido (el play es un gesto del usuario).
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video key={p.id} src={p.video} poster={p.imagen ?? undefined} controls playsInline preload="metadata" className="max-h-[60vh] w-full bg-black object-contain" />
        ) : (
          p.imagen && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imagen} alt="" className="max-h-[55vh] w-full bg-gray-100 object-contain" />
          )
        )}
        <div className="space-y-3 p-4 text-sm">
          <p className="flex items-center gap-2">
            <span className={cn("h-3 w-3 rounded-sm border-2", ESTADO[p.estado].extra)} style={{ borderColor: ESTADO[p.estado].borde }} />
            {ESTADO[p.estado].label}
            {p.marca && <span className="text-gray-500">· {p.marca.name}</span>}
          </p>
          {p.porque && p.estado !== "publicada" && <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">{p.porque}</p>}
          {p.texto && <p className="whitespace-pre-wrap text-gray-700">{p.texto}</p>}
          <div className="flex flex-wrap gap-2 pt-2">
            {p.estado === "propuesta" && (
              <a href="/aprobaciones" target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700">
                Ir a aprobar
              </a>
            )}
            {p.permalink && (
              <a href={p.permalink} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg border px-4 py-2 font-semibold hover:bg-gray-50">
                <ExternalLink className="h-4 w-4" /> Ver publicada
              </a>
            )}
          </div>
          <Acciones p={p} onListo={onCerrar} />
        </div>
      </aside>
    </div>
  )
}

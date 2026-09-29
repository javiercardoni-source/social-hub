"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Check, Clapperboard, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { analizarFeed, guardarEstiloGrilla } from "@/lib/cos/feed-actions"
import { explicarError } from "@/lib/ui-errors"
import { cn } from "@/lib/utils"
import { describirEstilo, evaluarEstilo, ordenarGrilla, type EstiloGrilla, type Pieza, type ReglaColumna } from "../../../../shared/cos/grilla"

export type Casilla = Pieza & { url: string | null; permalink: string | null; alcance: number | null }
export type AnalisisFeed = {
  status: "analizando" | "lista" | "error"
  error?: string
  resumen?: string
  observaciones?: string[]
  estilo_sugerido?: { columnas: [ReglaColumna, ReglaColumna, ReglaColumna]; por_que: string } | null
  otras_ideas?: string[]
  cambios_de_orden?: string[]
}

const REGLAS: { v: ReglaColumna; label: string }[] = [
  { v: "libre", label: "Libre" },
  { v: "con_texto", label: "Con texto" },
  { v: "sin_texto", label: "Sin texto" },
]
const COLUMNAS = ["Izquierda", "Centro", "Derecha"]

const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })

export function FeedClient(props: {
  brandName: string
  handle: string
  color: string
  casillas: Casilla[]
  estilo: EstiloGrilla
  analisis: AnalisisFeed | null
  analisisAt: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [conPendientes, setConPendientes] = useState(false)
  const [estilo, setEstilo] = useState<EstiloGrilla>(props.estilo)
  const [msg, setMsg] = useState<string | null>(null)
  const cambioEstilo = JSON.stringify(estilo) !== JSON.stringify(props.estilo)

  const grilla = useMemo(
    () => ordenarGrilla(props.casillas.filter((c) => conPendientes || c.estado !== "pendiente")) as Casilla[],
    [props.casillas, conPendientes],
  )
  const marcas = evaluarEstilo(grilla, estilo)
  const porSalir = grilla.filter((c) => c.estado !== "publicado").length
  const rompen = marcas.filter((m, i) => m === "rompe" && grilla[i].estado !== "publicado").length
  const analizando = props.analisis?.status === "analizando"

  // Mientras la IA analiza, la pantalla se actualiza sola.
  useEffect(() => {
    if (!analizando) return
    const t = setInterval(() => router.refresh(), 8000)
    return () => clearInterval(t)
  }, [analizando, router])

  const run = (fn: () => Promise<unknown>, ok?: string) =>
    start(async () => {
      setMsg(null)
      try {
        await fn()
        if (ok) setMsg(ok)
        router.refresh()
      } catch (e) {
        setMsg(explicarError(e))
      }
    })

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
      {/* El perfil */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <div className="rounded-full p-[2px]" style={{ background: "linear-gradient(45deg,#f58529,#dd2a7b,#8134af)" }}>
            <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-background text-sm font-extrabold text-white" style={{ backgroundColor: props.color }}>
              {props.brandName.slice(0, 1)}
            </div>
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate font-semibold">{props.handle}</p>
            <p className="text-xs text-muted-foreground">
              {porSalir ? `${porSalir} por salir` : "Nada programado"} · {grilla.length - porSalir} publicadas (las últimas)
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-1.5 text-xs">
            <input type="checkbox" checked={conPendientes} onChange={(e) => setConPendientes(e.target.checked)} />
            Sumar pendientes
          </label>
        </div>

        <div className="grid grid-cols-3 gap-0.5 bg-border">
          {grilla.map((c, i) => {
            const m = marcas[i]
            const futuro = c.estado !== "publicado"
            return (
              <div key={c.id} className={cn("relative aspect-[3/4] bg-muted", !futuro && "opacity-90")}>
                {c.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">sin imagen</div>
                )}
                {futuro && (
                  <span
                    className={cn(
                      "absolute left-1 top-1 rounded px-1.5 py-0.5 text-[9px] font-bold text-white",
                      c.estado === "pendiente" ? "bg-amber-600/90" : "bg-sky-600/90",
                    )}
                  >
                    {c.estado === "pendiente" ? "Pendiente" : c.at ? fecha(c.at) : "Programado"}
                  </span>
                )}
                {c.formato === "reel" && <Clapperboard className="absolute right-1 top-1 h-4 w-4 text-white drop-shadow" />}
                {m !== "sin_regla" && m !== "desconocido" && (
                  <span
                    title={m === "ok" ? "Cumple el estilo de su columna" : "No cumple el estilo de su columna"}
                    className={cn(
                      "absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full text-white",
                      m === "ok" ? "bg-emerald-600/90" : "bg-red-600/90",
                    )}
                  >
                    {m === "ok" ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                  </span>
                )}
                {!futuro && c.alcance != null && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1 text-[9px] text-white">{c.alcance.toLocaleString("es-AR")}</span>
                )}
                {futuro && <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-sky-500/70" />}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Estilo y análisis */}
      <div className="space-y-4">
        <Card className="space-y-3 p-4">
          <div>
            <p className="font-bold">Estilo de la grilla</p>
            <p className="text-xs text-muted-foreground">
              Qué lleva cada columna del perfil. Se marca con ✓ o ⚠ en lo que está por salir.
              {rompen > 0 && <b className="text-red-700"> {rompen} {rompen === 1 ? "pieza no cumple" : "piezas no cumplen"}.</b>}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {COLUMNAS.map((nombre, col) => (
              <div key={nombre} className="space-y-1">
                <p className="text-xs font-semibold">{nombre}</p>
                <div className="flex flex-col gap-1">
                  {REGLAS.map((r) => (
                    <button
                      key={r.v}
                      type="button"
                      onClick={() => {
                        const c = [...estilo.columnas] as EstiloGrilla["columnas"]
                        c[col] = r.v
                        setEstilo({ columnas: c })
                      }}
                      className={cn(
                        "rounded-lg border px-2 py-1 text-xs font-medium",
                        estilo.columnas[col] === r.v ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={pending || !cambioEstilo} onClick={() => run(() => guardarEstiloGrilla(estilo), "Estilo guardado")}>
              Guardar estilo
            </Button>
            {cambioEstilo && (
              <Button size="sm" variant="ghost" onClick={() => setEstilo(props.estilo)}>
                Deshacer
              </Button>
            )}
          </div>
          <p className="rounded-lg bg-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Ojo: cada publicación nueva corre a todas un lugar, así que una foto que hoy está en el centro pasa a la derecha con el
            próximo post. El patrón por columnas se sostiene <b>publicando de a 3</b>. Esta grilla muestra cómo queda cuando sale
            todo lo programado.
          </p>
        </Card>

        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="flex items-center gap-1.5 font-bold">
                <Sparkles className="h-4 w-4 text-primary" /> Análisis de la grilla
              </p>
              <p className="text-xs text-muted-foreground">
                La IA mira el perfil completo y las métricas: equilibrio, repeticiones, formatos y un estilo sugerido.
                {props.analisisAt && props.analisis?.status === "lista" && ` Último: ${fecha(props.analisisAt)}.`}
              </p>
            </div>
            <Button size="sm" disabled={pending || analizando} onClick={() => run(() => analizarFeed(conPendientes))}>
              {analizando || pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {analizando ? "Analizando…" : "Analizar con IA"}
            </Button>
          </div>
          {msg && <p className="rounded-lg bg-muted px-3 py-2 text-sm">{msg}</p>}
          {props.analisis?.status === "error" && <p className="text-sm text-destructive">No se pudo analizar: {props.analisis.error}</p>}
          {props.analisis?.status === "lista" && (
            <div className="space-y-3 text-sm">
              {props.analisis.resumen && <p className="font-medium">{props.analisis.resumen}</p>}
              <ListaTxt titulo="Lo que se ve" items={props.analisis.observaciones} />
              {props.analisis.estilo_sugerido && (
                <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-primary">Estilo sugerido</p>
                  <p className="font-semibold">{describirEstilo({ columnas: props.analisis.estilo_sugerido.columnas })}</p>
                  <p className="text-xs text-muted-foreground">{props.analisis.estilo_sugerido.por_que}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      const e = { columnas: props.analisis!.estilo_sugerido!.columnas }
                      setEstilo(e)
                      run(() => guardarEstiloGrilla(e), "Estilo sugerido aplicado")
                    }}
                  >
                    Aplicar este estilo
                  </Button>
                </div>
              )}
              <ListaTxt titulo="Cambios de orden que propone" items={props.analisis.cambios_de_orden} />
              <ListaTxt titulo="Otras ideas" items={props.analisis.otras_ideas} />
              <p className="text-[11px] text-muted-foreground">Nada se mueve solo: si querés cambiar algo, reprogramalo desde Calendario o Aprobaciones.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function ListaTxt({ titulo, items }: { titulo: string; items?: string[] }) {
  if (!items?.length) return null
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <ul className="ml-4 mt-1 list-disc space-y-0.5">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  )
}

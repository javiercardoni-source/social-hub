"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, RefreshCw, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { aprobarPropuesta, descartarPropuesta, pedirTanda, reintentarPropuesta } from "@/lib/cos/ads-actions"
import { explicarError } from "@/lib/ui-errors"
import { cn } from "@/lib/utils"

export type PropuestaUI = {
  id: string
  week: string
  kind: "reusar" | "reeditar" | "organico" | "variante"
  status: string
  title: string
  body: string
  daily_budget: number | null
  por_que: string
  error: string | null
  campaña: string | null
  conjunto: string | null
  origenThumb: string | null
  origenNombre: string | null
  piezas: { formato: string; tipo: string; url: string | null }[]
  meta: { adset_id?: string; ads?: Record<string, string> }
  /** Rearmado sobre publicaciones elegidas por la IA: hay que confirmar que sean producto real. */
  rearmado: boolean
  /** El ganador original parecía hecho con IA. */
  origenIA: boolean
}

const TIPO: Record<PropuestaUI["kind"], string> = {
  reusar: "Ganador con texto nuevo",
  reeditar: "Ganador re-editado",
  organico: "Pautar un orgánico",
  variante: "Variante del mismo diseño",
}
const ESTADO: Record<string, { t: string; c: string }> = {
  preparando: { t: "Armando la pieza…", c: "bg-muted text-muted-foreground" },
  propuesta: { t: "Para aprobar", c: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  aprobada: { t: "Aprobada · creando en Meta", c: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  creando: { t: "Creando en Meta (pausado)…", c: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  creada: { t: "En Meta, PAUSADA", c: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  descartada: { t: "Descartada", c: "bg-muted text-muted-foreground" },
  error: { t: "Falló", c: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
}

export function PedirTanda() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="hidden text-xs text-muted-foreground md:inline">{msg}</span>}
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              await pedirTanda()
              setMsg("Pedida: tarda unos minutos (revisa las piezas y las arma)")
              router.refresh()
            } catch (e) {
              setMsg(explicarError(e))
            }
          })
        }
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Armar tanda ahora
      </Button>
    </div>
  )
}

function Tarjeta({ p }: { p: PropuestaUI }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState(p.title)
  const [body, setBody] = useState(p.body)
  const [budget, setBudget] = useState(p.daily_budget != null ? String(Math.round(p.daily_budget)) : "")
  const editable = p.status === "propuesta"
  const correr = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null)
      try {
        await fn()
        router.refresh()
      } catch (e) {
        setError(explicarError(e))
      }
    })
  const est = ESTADO[p.status] ?? { t: p.status, c: "bg-muted" }

  return (
    <Card className={cn(p.status === "descartada" && "opacity-60")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{TIPO[p.kind]}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", est.c)}>{est.t}</span>
        </div>
        <p className="text-sm text-muted-foreground">{p.por_que}</p>
        {p.origenIA && (
          <p className="rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-900 dark:bg-red-950 dark:text-red-200">
            Ojo: el anuncio ganador original parecía hecho con IA, y las publicaciones parecidas de la marca pueden serlo también. Aprobalo solo si ves producto real.
          </p>
        )}
        {p.rearmado && (
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Las tomas son publicaciones de Instagram que eligió la IA. Antes de aprobar, mirá el video: tiene que ser producto real (nada hecho con IA).
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          {p.piezas.map((x) => (
            <figure key={x.formato} className="space-y-1">
              {x.url ? (
                x.tipo === "video" ? (
                  <video src={x.url} controls muted playsInline preload="metadata" className={cn("rounded-lg bg-black", x.formato === "4x5" ? "aspect-[4/5] w-40" : x.formato === "9x16" ? "aspect-[9/16] w-36" : "w-40")} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={x.url} alt="" className="w-40 rounded-lg" />
                )
              ) : (
                <div className="flex h-40 w-36 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">sin vista previa</div>
              )}
              <figcaption className="text-center text-[11px] text-muted-foreground">{x.formato === "original" ? "la pieza del ganador" : x.formato.replace("x", ":")}</figcaption>
            </figure>
          ))}
          {p.status === "preparando" && <div className="flex h-40 w-36 items-center justify-center rounded-lg border-2 border-dashed text-xs text-muted-foreground">Armando…</div>}
          {p.origenThumb && (
            <figure className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.origenThumb} alt="" className="w-24 rounded-lg opacity-80" />
              <figcaption className="max-w-24 truncate text-center text-[11px] text-muted-foreground" title={p.origenNombre ?? ""}>el ganador original</figcaption>
            </figure>
          )}
        </div>

        <div className="grid gap-2">
          <label className="text-xs font-semibold text-muted-foreground" htmlFor={`t-${p.id}`}>Título</label>
          <input id={`t-${p.id}`} value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editable || pending} maxLength={60} className="rounded-lg border bg-background px-3 py-2 text-sm" />
          <label className="text-xs font-semibold text-muted-foreground" htmlFor={`b-${p.id}`}>Texto (el precio va acá, nunca en la pieza)</label>
          <textarea id={`b-${p.id}`} value={body} onChange={(e) => setBody(e.target.value)} disabled={!editable || pending} rows={4} maxLength={600} className="rounded-lg border bg-background px-3 py-2 text-sm" />
          <label className="text-xs font-semibold text-muted-foreground" htmlFor={`p-${p.id}`}>Presupuesto diario</label>
          {p.daily_budget != null ? (
            <input id={`p-${p.id}`} inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/\D/g, ""))} disabled={!editable || pending} className="w-40 rounded-lg border bg-background px-3 py-2 text-sm" />
          ) : (
            <p id={`p-${p.id}`} className="text-sm text-muted-foreground">Lo maneja la campaña (presupuesto de campaña).</p>
          )}
          <p className="text-xs text-muted-foreground">
            Copia el público y la configuración de: {p.conjunto ?? "—"} {p.campaña ? `(campaña ${p.campaña})` : ""}
          </p>
        </div>

        {p.error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">{p.error}</p>}
        {p.status === "creada" && p.meta.adset_id && (
          <p className="text-xs text-muted-foreground">
            En Meta: conjunto {p.meta.adset_id} · anuncios {Object.values(p.meta.ads ?? {}).join(", ")} — todo en pausa.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button
              disabled={pending}
              onClick={() => correr(() => aprobarPropuesta(p.id, { title, body, daily_budget: p.daily_budget != null && budget ? Number(budget) : null }))}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Aprobar y crear en Meta (pausado)
            </Button>
          )}
          {p.status === "error" && (
            <Button variant="outline" disabled={pending} onClick={() => correr(() => reintentarPropuesta(p.id))}>
              <RotateCcw className="h-4 w-4" /> Reintentar
            </Button>
          )}
          {["propuesta", "error", "preparando"].includes(p.status) && (
            <Button variant="ghost" disabled={pending} onClick={() => correr(() => descartarPropuesta(p.id))}>
              <X className="h-4 w-4" /> Descartar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function Propuestas({ propuestas, semana }: { propuestas: PropuestaUI[]; semana: string }) {
  if (!propuestas.length) {
    return (
      <p className="rounded-xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">
        Todavía no hay tanda para la semana del {semana}. Sale sola los lunes a las 7; con «Armar tanda ahora» sale en unos minutos. Si los ganadores tienen precio
        o sellos sobre la pieza y no hay fotos reales del producto para rearmarlos, la tanda puede salir vacía: el detalle está en «Ranking y filtro».
      </p>
    )
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {propuestas.map((p) => (
        <Tarjeta key={p.id} p={p} />
      ))}
    </div>
  )
}

"use client"

import { useState, useTransition } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Check, CheckCheck, Clapperboard, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { armarReelConVarias, descartarVarios, recuperarVarios, usarVarios } from "@/lib/cos/actions"
import { explicarError } from "@/lib/ui-errors"
import { cn } from "@/lib/utils"
import { ArchivoAcciones } from "./archivo-client"

export type ArchivoItem = {
  id: string
  description: string | null
  media_type: string | null
  status: string
  quality_score: number | null
  thumb: string | null
  source: string
  review_status: string
  category: string | null
  risk_flags: string[]
  consent: string
  brand: { name: string; color: string } | null
  rend: Record<string, number> | null
}

/**
 * Grilla del Archivo con selección: tildás varias y las descartás (o, en Descartados, las
 * recuperás) de una vez. Nunca toca Drive ni Instagram: solo las saca de Social Hub.
 */
export function ArchivoGrid({ items, estado }: { items: ArchivoItem[]; estado: "pendientes" | "usados" | "descartados" }) {
  const router = useRouter()
  // Array (no Set): el orden en que se tocan es el orden de las piezas en el reel.
  const [sel, setSelArr] = useState<string[]>([])
  const setSel = (x: Set<string> | ((s: Set<string>) => Set<string>)) =>
    setSelArr((prev) => [...(typeof x === "function" ? x(new Set(prev)) : x)])
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const seleccionable = estado !== "usados"
  const visibles = items.map((i) => i.id)
  const todos = visibles.length > 0 && visibles.every((id) => sel.includes(id))
  // Para el reel solo cuentan las ya analizadas, en el orden en que se marcaron.
  const listas = new Set(items.filter((i) => i.quality_score != null && ["READY", "IN_USE"].includes(i.status)).map((i) => i.id))
  const paraReel = sel.filter((id) => listas.has(id))

  function armarReel() {
    setMsg(null)
    start(async () => {
      try {
        const r = await armarReelConVarias(paraReel)
        setMsg(`Armando un reel con ${r.piezas} piezas: en unos minutos aparece en Aprobaciones`)
        setSel(new Set())
        router.refresh()
      } catch (e) {
        setMsg(explicarError(e))
      }
    })
  }

  // «Usar» de todas las marcadas: cada una arma su reel y sus posts (como el «Usar» de cada ficha).
  const paraUsar = sel.filter((id) => {
    const it = items.find((i) => i.id === id)
    return !!it && listas.has(id) && it.consent !== "blocked" && it.review_status !== "approved"
  })
  function usarMarcadas() {
    setMsg(null)
    start(async () => {
      try {
        const r = await usarVarios(paraUsar)
        const extra = [r.bloqueadas ? `${r.bloqueadas} con caras (piden permiso una por una)` : "", r.analizando ? `${r.analizando} todavía analizándose` : ""].filter(Boolean).join(" · ")
        setMsg(`Armando borradores de ${r.usadas}: van apareciendo en Aprobaciones${extra ? ` · Quedaron afuera: ${extra}` : ""}`)
        setSel(new Set())
        router.refresh()
      } catch (e) {
        setMsg(explicarError(e))
      }
    })
  }

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  function aplicar() {
    const ids = sel.filter((id) => visibles.includes(id))
    setMsg(null)
    start(async () => {
      try {
        if (estado === "descartados") {
          const r = await recuperarVarios(ids)
          setMsg(`${r.recuperados} de vuelta en «Para revisar»`)
        } else {
          const r = await descartarVarios(ids)
          setMsg(`${r.descartados} descartadas (no se analizan ni se vuelven a traer)`)
        }
        setSel(new Set())
        router.refresh()
      } catch (e) {
        setMsg(explicarError(e))
      }
    })
  }

  return (
    <>
      {seleccionable && items.length > 0 && (
        <div className="sticky top-0 z-10 -mx-1 mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 px-3 py-2 backdrop-blur">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(visibles))} className="h-4 w-4" />
            Seleccionar todas las de la pantalla
          </label>
          <span className="text-xs text-muted-foreground">{sel.length ? `${sel.length} seleccionadas` : "o tocá las fotos para marcarlas"}</span>
          {estado === "pendientes" && (
            <Button
              size="sm"
              className="ml-auto"
              disabled={!paraUsar.length || pending}
              title="Usar todas las marcadas que ya están analizadas: cada una arma su reel y sus posts"
              onClick={usarMarcadas}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Usar {paraUsar.length ? `las ${paraUsar.length}` : "marcadas"}
            </Button>
          )}
          {estado === "pendientes" && (
            <Button
              size="sm"
              variant="outline"
              disabled={paraReel.length < 2 || paraReel.length > 8 || pending}
              title="Un reel con las piezas marcadas, en el orden en que las tocaste (2 a 8, ya analizadas)"
              onClick={armarReel}
            >
              <Clapperboard className="h-3.5 w-3.5" />
              Armar reel{paraReel.length >= 2 ? ` (${paraReel.length})` : ""}
            </Button>
          )}
          <Button
            size="sm"
            variant={estado === "descartados" ? "default" : "destructive"}
            className={estado === "pendientes" ? "" : "ml-auto"}
            disabled={!sel.length || pending}
            onClick={aplicar}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {estado === "descartados" ? `Recuperar ${sel.length || ""}` : `Descartar ${sel.length || ""}`}
          </Button>
          {msg && <p className="w-full text-xs text-muted-foreground">{msg}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((r) => {
          // Lo descartado queda ARCHIVED: si tiene puntaje, se había llegado a analizar.
          const analizado = r.quality_score != null && (estado === "descartados" || ["READY", "IN_USE"].includes(r.status))
          const marcado = sel.includes(r.id)
          const orden = paraReel.indexOf(r.id)
          return (
            <div key={r.id} className={cn("flex flex-col overflow-hidden rounded-xl border bg-card", marcado && "ring-2 ring-primary")}>
              <button
                type="button"
                disabled={!seleccionable}
                onClick={() => toggle(r.id)}
                aria-pressed={marcado}
                aria-label={marcado ? "Desmarcar" : "Marcar"}
                className="relative aspect-square bg-muted text-left disabled:cursor-default"
              >
                {r.thumb && <Image src={r.thumb} alt="" fill className={cn("object-cover", marcado && "opacity-80")} sizes="220px" />}
                <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {r.source === "instagram" ? "Ya publicado en IG" : r.source === "drive" ? "Base de fotos" : r.source === "embajadores" ? "Embajador" : "Carpeta"}
                </span>
                {r.media_type === "video" && <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">Video</span>}
                {seleccionable && (
                  <span
                    className={cn(
                      "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border-2",
                      marcado ? "border-primary bg-primary text-white" : "border-white/90 bg-black/30",
                    )}
                  >
                    {marcado && (estado === "pendientes" && orden >= 0 && paraReel.length > 1 ? <span className="text-xs font-bold">{orden + 1}</span> : <Check className="h-4 w-4" />)}
                  </span>
                )}
              </button>
              <div className="flex flex-1 flex-col gap-1.5 p-2.5 text-xs">
                {analizado ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="font-bold">Calidad {r.quality_score}</span>
                      {r.brand && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.brand.color }} />
                          {r.brand.name}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-3 text-muted-foreground">{r.description}</p>
                    {r.category && <p className="text-[10px] text-muted-foreground/70">{r.category}</p>}
                    {r.rend && (
                      <p className="text-[10px] font-medium text-emerald-700">
                        Cuando se publicó: {(r.rend.reach || r.rend.views || 0).toLocaleString("es-AR")} {r.rend.reach ? "alcance" : "vistas"} · {r.rend.total_interactions ?? 0} interacc.
                      </p>
                    )}
                    {!!r.risk_flags.length && <p className="text-[10px] text-amber-700">⚠ {r.risk_flags.join(", ").replace(/_/g, " ")}</p>}
                  </>
                ) : estado === "descartados" ? (
                  <p className="text-muted-foreground">Descartada antes de analizarse</p>
                ) : (
                  <p className="text-muted-foreground">La IA lo está analizando…</p>
                )}
                {estado !== "descartados" && (
                  <div className="mt-auto pt-1">
                    <ArchivoAcciones id={r.id} listo={analizado} usado={r.review_status === "approved"} bloqueado={r.consent === "blocked"} />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

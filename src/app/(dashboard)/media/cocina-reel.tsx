"use client"

import { createContext, useContext, useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Clapperboard, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { armarReelConVarias } from "@/lib/cos/actions"
import { explicarError } from "@/lib/ui-errors"
import { cn } from "@/lib/utils"

/**
 * "Armar reel" en «De la cocina» (F9 etapa 2): se marcan piezas en el orden en que van al
 * reel y se arma uno solo con todas. La grilla sigue siendo del servidor; esto solo lleva la
 * selección.
 */
const Ctx = createContext<{ sel: string[]; toggle: (id: string) => void } | null>(null)

export function SeleccionReel({ children }: { children: ReactNode }) {
  const [sel, setSel] = useState<string[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  return (
    <Ctx.Provider value={{ sel, toggle }}>
      {(sel.length > 0 || msg) && (
        <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 px-3 py-2 backdrop-blur">
          <span className="text-sm">{sel.length ? `${sel.length} marcadas para el reel` : ""}</span>
          {sel.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSel([])} disabled={pending}>
              Desmarcar
            </Button>
          )}
          <Button
            size="sm"
            className="ml-auto"
            disabled={sel.length < 2 || sel.length > 8 || pending}
            onClick={() =>
              start(async () => {
                try {
                  const r = await armarReelConVarias(sel)
                  setMsg(`Armando un reel con ${r.piezas} piezas: en unos minutos aparece en Aprobaciones`)
                  setSel([])
                  router.refresh()
                } catch (e) {
                  setMsg(explicarError(e))
                }
              })
            }
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="h-3.5 w-3.5" />}
            Armar reel{sel.length >= 2 ? ` (${sel.length})` : ""}
          </Button>
          <p className="w-full text-xs text-muted-foreground">{msg ?? "De 2 a 8 piezas, en el orden en que las marcás."}</p>
        </div>
      )}
      {children}
    </Ctx.Provider>
  )
}

/** Casilla de una tarjeta: muestra el número de orden en el reel. */
export function MarcaReel({ id }: { id: string }) {
  const c = useContext(Ctx)
  if (!c) return null
  const n = c.sel.indexOf(id)
  return (
    <button
      type="button"
      aria-pressed={n >= 0}
      aria-label={n >= 0 ? `Pieza ${n + 1} del reel: desmarcar` : "Marcar para armar un reel"}
      onClick={() => c.toggle(id)}
      className={cn(
        "absolute bottom-2 left-2 z-10 flex h-8 min-w-8 items-center justify-center gap-1 rounded-md border-2 px-1.5 text-xs font-bold text-white",
        n >= 0 ? "border-primary bg-primary" : "border-white/90 bg-black/40",
      )}
    >
      {n >= 0 ? n + 1 : <Clapperboard className="h-4 w-4" />}
    </button>
  )
}

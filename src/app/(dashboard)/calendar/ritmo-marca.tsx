"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { guardarRitmo } from "@/lib/cos/campanias-actions"
import { explicarError } from "@/lib/ui-errors"

/** Ritmo de publicación de la marca: con esto la agenda llena semana por semana (90 días). */
export function RitmoMarca(props: { marca: string; ritmo: { postsSemana: number; historiasDia: number }; sinHora: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [ritmo, setRitmo] = useState(props.ritmo)
  const cambiado = ritmo.postsSemana !== props.ritmo.postsSemana || ritmo.historiasDia !== props.ritmo.historiasDia
  return (
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
      {cambiado && (
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
  )
}

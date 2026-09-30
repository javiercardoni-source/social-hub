"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CalendarClock, CloudRain, Globe, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cambiarLlaveAgenda, guardarHorarios, leerHorariosDeLaWeb } from "@/lib/cos/agenda-actions"
import { explicarError } from "@/lib/ui-errors"
import { cn } from "@/lib/utils"
import type { Apertura } from "../../../../shared/cos/agenda"

export type AgendaMarca = {
  auto: boolean
  climaHistorias: boolean
  horarios: Apertura | null
  propuesta: Apertura | null
  fuente: string | null
  leidoAt: string | null
}

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
const texto = (ap: Apertura | null, d: number) => (ap?.[String(d)] ?? []).map((t) => `${t.desde}-${t.hasta}`).join(", ")

/** Una llave grande, fácil de tocar en el celular. */
function Llave({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn("relative h-8 w-14 shrink-0 rounded-full transition-colors", on ? "bg-emerald-600" : "bg-muted-foreground/30")}
    >
      <span className={cn("absolute top-0.5 h-7 w-7 rounded-full bg-white shadow transition-all", on ? "left-[26px]" : "left-0.5")} />
    </button>
  )
}

export function AgendaMarcaPanel({ brandName, agenda }: { brandName: string; agenda: AgendaMarca }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [dias, setDias] = useState(() => Array.from({ length: 7 }, (_, d) => texto(agenda.horarios, d)))
  const run = (fn: () => Promise<unknown>, ok: string) =>
    start(async () => {
      setMsg(null)
      try {
        await fn()
        setMsg(ok)
        router.refresh()
      } catch (e) {
        setMsg(explicarError(e))
      }
    })
  const hayPropuesta = !!agenda.propuesta && Array.from({ length: 7 }, (_, d) => texto(agenda.propuesta, d)).join("|") !== dias.join("|")

  return (
    <Card className="flex min-h-[70vh] flex-col overflow-hidden">
      <div className="border-b px-4 py-3">
        <p className="font-bold">Agenda · {brandName}</p>
        <p className="text-xs text-muted-foreground">El sistema elige día y hora de cada publicación según tus métricas, los feriados y el clima. Vos seguís aprobando todo.</p>
      </div>
      {msg && <p className="mx-4 mt-3 rounded-lg bg-muted px-3 py-2 text-sm">{msg}</p>}

      <div className="flex flex-col gap-6 p-4">
        <section className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="flex-1">
            <p className="font-semibold">Agenda automática</p>
            <p className="text-xs text-muted-foreground">
              Cada borrador llega a Aprobaciones con su horario y el porqué. Al aprobar, sale en ese horario; si cambia el pronóstico, el
              motor puede moverlo dentro del día (nunca a menos de 3 h). Lo que programes a mano 🔒 no se toca. Más o menos 1 de cada 6
              va a un horario con poca historia 🧪, para seguir aprendiendo.
            </p>
          </div>
          <Llave label="Agenda automática" on={agenda.auto} disabled={pending} onChange={(v) => run(() => cambiarLlaveAgenda("agenda_auto", v), v ? "Agenda prendida: en un minuto aparecen los horarios en Aprobaciones." : "Agenda apagada. Los borradores que esperan tu OK pierden el horario propuesto: lo elegís al aprobar.")} />
        </section>

        <section className="flex items-start gap-3">
          <CloudRain className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
          <div className="flex-1">
            <p className="font-semibold">Historias de clima</p>
            <p className="text-xs text-muted-foreground">
              Días de lluvia: un aviso amable antes del servicio (la demora puede ser un poco mayor por la calzada mojada). Días lindos,
              de frío o de calor: una historia con buena onda, solo cuando el clima cambia. Si el pronóstico cambia, se vencen solas.
            </p>
          </div>
          <Llave label="Historias de clima" on={agenda.climaHistorias} disabled={pending} onChange={(v) => run(() => cambiarLlaveAgenda("clima_historias", v), v ? "Historias de clima prendidas." : "Historias de clima apagadas.")} />
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 font-semibold">Horarios de apertura</p>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(leerHorariosDeLaWeb, "Leyendo la web… en un minuto aparece la propuesta (recargá).")}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
              Leer de la web
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Se publica de 9 a 22 h y solo los días que abre la marca; las historias de clima salen antes de que abra. Escribí cada turno
            como 19:00-23:30 (varios separados por coma). Vacío = no abre.
          </p>
          {hayPropuesta && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
              <p className="font-semibold">La IA leyó estos horarios{agenda.fuente ? ` (${agenda.fuente})` : ""}:</p>
              <ul className="mt-1 grid gap-0.5 text-xs sm:grid-cols-2">
                {DIAS.map((d, i) => (
                  <li key={d}>
                    {d}: {texto(agenda.propuesta, i) || "no abre"}
                  </li>
                ))}
              </ul>
              <Button size="sm" className="mt-2" disabled={pending} onClick={() => setDias(Array.from({ length: 7 }, (_, d) => texto(agenda.propuesta, d)))}>
                Usar estos (después tocá Guardar)
              </Button>
            </div>
          )}
          {!agenda.horarios && !hayPropuesta && (
            <p className="text-xs text-amber-700">
              {agenda.fuente ?? "Todavía sin horarios confirmados: tocá «Leer de la web» para que la IA los busque, o escribilos vos."}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {DIAS.map((d, i) => (
              <label key={d} className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0 text-muted-foreground">{d}</span>
                <input
                  value={dias[i]}
                  onChange={(e) => setDias((x) => x.map((v, j) => (j === i ? e.target.value : v)))}
                  placeholder="no abre"
                  inputMode="text"
                  aria-label={`Horarios del ${d.toLowerCase()}, por ejemplo 19:00-23:30`}
                  className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-base outline-none focus:ring-2 focus:ring-primary/40 sm:text-sm"
                />
              </label>
            ))}
          </div>
          <div>
            <Button size="sm" disabled={pending} onClick={() => run(() => guardarHorarios(dias), "Horarios guardados.")}>
              Guardar horarios
            </Button>
            {!agenda.horarios && <span className="ml-2 text-xs text-amber-700">Todavía sin confirmar: se usan los días de la configuración vieja.</span>}
          </div>
        </section>
      </div>
    </Card>
  )
}

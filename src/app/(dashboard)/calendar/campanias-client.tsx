"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { activarCampania, borrarCampania, guardarCampania } from "@/lib/cos/campanias-actions"
import { TIPOS_CAMPANIA, type Campania } from "../../../../shared/cos/campanias"
import { explicarError } from "@/lib/ui-errors"
import { cn } from "@/lib/utils"

const input = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
const corta = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "UTC" })
const VACIA = { nombre: "", tipo: "propia", desde: "", hasta: "", objetivo: "", mensaje: "", productos: "", tono: "", color: "#64748b" }

/**
 * Campañas de la marca: temporadas, fechas comerciales y propias. La IA usa la vigente (y la que
 * empieza en las próximas 3 semanas) al escribir textos y elegir plantillas.
 */
export function Campanias({ campanias, hoy }: { campanias: Campania[]; hoy: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id: string | null; datos: typeof VACIA } | null>(null)
  const [verPasadas, setVerPasadas] = useState(false)
  const lista = campanias.filter((c) => verPasadas || c.hasta >= hoy)
  const vigentes = campanias.filter((c) => c.activa && c.desde <= hoy && hoy <= c.hasta)

  const run = (fn: () => Promise<void>, ok?: string) =>
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
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Campañas</h2>
        {vigentes.length > 0 && <span className="text-sm text-muted-foreground">· hoy: {vigentes.map((c) => c.nombre).join(" + ")}</span>}
        <Button size="sm" className="ml-auto" onClick={() => setEdit({ id: null, datos: { ...VACIA, desde: hoy, hasta: hoy } })}>
          <Plus className="h-3.5 w-3.5" /> Nueva campaña
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Cada campaña le da a la IA el tema y el tono de esa época: lo usa al escribir los textos y al elegir la plantilla de las piezas. Completá el
        mensaje y los productos foco de las que vienen. Una campaña nunca inventa descuentos: las promos salen solo de Datos vigentes.
      </p>

      {edit && (
        <form
          className="grid gap-2 rounded-xl bg-muted/50 p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            run(async () => {
              await guardarCampania(edit.id, edit.datos)
              setEdit(null)
            }, "Campaña guardada")
          }}
        >
          <input className={cn(input, "sm:col-span-2")} placeholder="Nombre (ej. Primavera: sushi al aire libre)" value={edit.datos.nombre} onChange={(e) => setEdit({ ...edit, datos: { ...edit.datos, nombre: e.target.value } })} />
          <label className="text-xs text-muted-foreground">
            Desde
            <input type="date" className={input} value={edit.datos.desde} onChange={(e) => setEdit({ ...edit, datos: { ...edit.datos, desde: e.target.value } })} />
          </label>
          <label className="text-xs text-muted-foreground">
            Hasta
            <input type="date" className={input} value={edit.datos.hasta} onChange={(e) => setEdit({ ...edit, datos: { ...edit.datos, hasta: e.target.value } })} />
          </label>
          <label className="text-xs text-muted-foreground">
            Tipo
            <select className={input} value={edit.datos.tipo} onChange={(e) => setEdit({ ...edit, datos: { ...edit.datos, tipo: e.target.value } })}>
              {TIPOS_CAMPANIA.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Color en el calendario
            <input type="color" className="block h-9 w-full rounded-lg border bg-background" value={edit.datos.color} onChange={(e) => setEdit({ ...edit, datos: { ...edit.datos, color: e.target.value } })} />
          </label>
          <label className="text-xs text-muted-foreground sm:col-span-2">
            Objetivo (qué queremos lograr)
            <input className={input} maxLength={300} placeholder="Que pidan combos para compartir los fines de semana" value={edit.datos.objetivo} onChange={(e) => setEdit({ ...edit, datos: { ...edit.datos, objetivo: e.target.value } })} />
          </label>
          <label className="text-xs text-muted-foreground sm:col-span-2">
            Mensaje (la idea que se repite en todas las piezas)
            <input className={input} maxLength={300} placeholder="La primavera se disfruta afuera: llevate el sushi a la plaza" value={edit.datos.mensaje} onChange={(e) => setEdit({ ...edit, datos: { ...edit.datos, mensaje: e.target.value } })} />
          </label>
          <label className="text-xs text-muted-foreground">
            Productos o combos foco
            <input className={input} maxLength={200} value={edit.datos.productos} onChange={(e) => setEdit({ ...edit, datos: { ...edit.datos, productos: e.target.value } })} />
          </label>
          <label className="text-xs text-muted-foreground">
            Tono
            <input className={input} maxLength={120} placeholder="Fresco, al aire libre" value={edit.datos.tono} onChange={(e) => setEdit({ ...edit, datos: { ...edit.datos, tono: e.target.value } })} />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEdit(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}

      <div className="space-y-2">
        {lista.map((c) => {
          const vigente = c.desde <= hoy && hoy <= c.hasta
          const falta = [!c.mensaje && "mensaje", !c.objetivo && "objetivo"].filter(Boolean)
          return (
            <div key={c.id} className={cn("flex flex-wrap items-start gap-3 rounded-lg border p-3", !c.activa && "opacity-50")}>
              <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">
                  {c.nombre}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {corta(c.desde)} al {corta(c.hasta)} · {TIPOS_CAMPANIA.find((t) => t.id === c.tipo)?.label}
                    {vigente && c.activa ? " · vigente" : ""}
                  </span>
                </p>
                {c.mensaje && <p className="text-muted-foreground">{c.mensaje}</p>}
                {(c.objetivo || c.productos || c.tono) && <p className="text-xs text-muted-foreground">{[c.objetivo, c.productos && `Foco: ${c.productos}`, c.tono && `Tono: ${c.tono}`].filter(Boolean).join(" · ")}</p>}
                {c.activa && falta.length > 0 && <p className="text-xs text-amber-700">Falta {falta.join(" y ")}: la IA solo sabe el nombre y las fechas.</p>}
              </div>
              <div className="flex items-center gap-1">
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input type="checkbox" checked={c.activa} disabled={pending} onChange={(e) => run(() => activarCampania(c.id, e.target.checked))} /> activa
                </label>
                <Button size="sm" variant="ghost" aria-label={`Editar ${c.nombre}`} onClick={() => setEdit({ id: c.id, datos: { nombre: c.nombre, tipo: c.tipo, desde: c.desde, hasta: c.hasta, objetivo: c.objetivo, mensaje: c.mensaje, productos: c.productos, tono: c.tono, color: c.color } })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Borrar ${c.nombre}`} disabled={pending} onClick={() => confirm(`¿Borrar la campaña «${c.nombre}»?`) && run(() => borrarCampania(c.id))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )
        })}
        {!lista.length && <p className="text-sm text-muted-foreground">No hay campañas.</p>}
      </div>
      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setVerPasadas((v) => !v)}>
        {verPasadas ? "Ocultar las que ya terminaron" : "Ver también las que ya terminaron"}
      </button>
    </Card>
  )
}

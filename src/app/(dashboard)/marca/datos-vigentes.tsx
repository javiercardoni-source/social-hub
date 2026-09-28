"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle, Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { guardarDatosVigentes } from "@/lib/cos/branding-actions"
import { explicarError } from "@/lib/ui-errors"
import { cn } from "@/lib/utils"
import type { Combo, DatosVigentes, Link, Promo } from "../../../../shared/cos/datos-vigentes"

const campo = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"

function Seccion({ titulo, ayuda, children }: { titulo: string; ayuda: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <p className="text-sm font-bold">{titulo}</p>
        <p className="text-xs text-muted-foreground">{ayuda}</p>
      </div>
      {children}
    </section>
  )
}

/**
 * Ficha de datos comerciales vigentes: lo único de donde la IA puede sacar precios, combos,
 * promos, horarios, zonas y links. Lo que no esté acá, no se menciona.
 */
export function DatosVigentesForm({ brandName, datos, actualizado }: { brandName: string; datos: DatosVigentes; actualizado: string | null }) {
  const router = useRouter()
  const [d, setD] = useState<DatosVigentes>(datos)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const cambiado = JSON.stringify(d) !== JSON.stringify(datos)

  const set = <K extends keyof DatosVigentes>(k: K, v: DatosVigentes[K]) => setD((x) => ({ ...x, [k]: v }))
  const editar = <T,>(lista: T[], i: number, cambio: Partial<T>) => lista.map((x, j) => (j === i ? { ...x, ...cambio } : x))

  function guardar() {
    setMsg(null)
    start(async () => {
      try {
        await guardarDatosVigentes(d)
        setMsg({ ok: true, text: "Guardado. Los próximos borradores ya usan estos datos." })
        router.refresh()
      } catch (e) {
        setMsg({ ok: false, text: explicarError(e) })
      }
    })
  }

  return (
    <Card className="flex min-h-[70vh] flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="font-bold">Datos vigentes · {brandName}</p>
          <p className="text-xs text-muted-foreground">
            Lo único de donde la IA saca precios, combos, promos, horarios y links. Lo que no esté acá, no lo menciona.
            {actualizado && ` Última actualización: ${new Date(actualizado).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" })}.`}
          </p>
        </div>
        <Button size="sm" disabled={pending || !cambiado} onClick={guardar}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
          Guardar
        </Button>
      </div>

      {msg && (
        <p className={cn("mx-4 mt-3 rounded-lg px-3 py-2 text-sm", msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-destructive/10 text-destructive")}>{msg.text}</p>
      )}

      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        <Seccion titulo="Combos" ayuda="Destildá los que ya no se venden. Sin precio cargado, la IA nombra el combo pero no dice cuánto cuesta.">
          <div className="space-y-2">
            {d.combos.map((c, i) => (
              <div key={i} className={cn("grid gap-2 rounded-xl border p-2 sm:grid-cols-[1fr_1.4fr_110px_auto_auto]", !c.activo && "opacity-50")}>
                <input className={campo} placeholder="Nombre (ej: Puro Salmón)" value={c.nombre} onChange={(e) => set("combos", editar<Combo>(d.combos, i, { nombre: e.target.value }))} />
                <input className={campo} placeholder="Qué trae (ej: 40 piezas todo salmón)" value={c.detalle} onChange={(e) => set("combos", editar<Combo>(d.combos, i, { detalle: e.target.value }))} />
                <input className={campo} placeholder="$ precio" value={c.precio} onChange={(e) => set("combos", editar<Combo>(d.combos, i, { precio: e.target.value }))} />
                <label className="flex items-center gap-1.5 px-1 text-xs">
                  <input type="checkbox" checked={c.activo} onChange={(e) => set("combos", editar<Combo>(d.combos, i, { activo: e.target.checked }))} /> Se vende
                </label>
                <button type="button" aria-label="Quitar combo" className="justify-self-end p-2 text-muted-foreground hover:text-destructive" onClick={() => set("combos", d.combos.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => set("combos", [...d.combos, { nombre: "", detalle: "", precio: "", activo: true }])}>
              <Plus className="h-3.5 w-3.5" /> Agregar combo
            </Button>
          </div>
        </Seccion>

        <Seccion titulo="Promos activas" ayuda="Con fecha de fin, la IA deja de mencionarla sola al día siguiente.">
          <div className="space-y-2">
            {d.promos.map((p, i) => (
              <div key={i} className="grid gap-2 rounded-xl border p-2 sm:grid-cols-[1fr_160px_auto]">
                <input className={campo} placeholder="Ej: Si pedís antes de las 20, pagás menos" value={p.texto} onChange={(e) => set("promos", editar<Promo>(d.promos, i, { texto: e.target.value }))} />
                <input type="date" className={campo} aria-label="Hasta" value={p.hasta ?? ""} onChange={(e) => set("promos", editar<Promo>(d.promos, i, { hasta: e.target.value || null }))} />
                <button type="button" aria-label="Quitar promo" className="justify-self-end p-2 text-muted-foreground hover:text-destructive" onClick={() => set("promos", d.promos.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => set("promos", [...d.promos, { texto: "", hasta: null }])}>
              <Plus className="h-3.5 w-3.5" /> Agregar promo
            </Button>
          </div>
        </Seccion>

        <Seccion titulo="Horarios, zonas y retiro" ayuda="Escribilo como se lo dirías a un cliente.">
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={campo} placeholder="Horarios (ej: martes a domingo de 19 a 23:30)" value={d.horarios} onChange={(e) => set("horarios", e.target.value)} />
            <input className={campo} placeholder="Retiro (ej: Paternal, Av. … — o vacío si no hay)" value={d.retiro} onChange={(e) => set("retiro", e.target.value)} />
            <textarea rows={2} className={cn(campo, "sm:col-span-2")} placeholder="Zonas de envío (ej: CABA, Olivos, Vicente López…)" value={d.zonas} onChange={(e) => set("zonas", e.target.value)} />
          </div>
        </Seccion>

        <Seccion titulo="Dónde se pide" ayuda="El llamado a la acción de los posts usa estos canales.">
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={campo} placeholder="WhatsApp (ej: 11 5555-5555)" value={d.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
            <input className={campo} placeholder="Web para pedir" value={d.web} onChange={(e) => set("web", e.target.value)} />
          </div>
          <div className="space-y-2">
            {d.links.map((l, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                <input className={campo} placeholder="Nombre (ej: Combo Aki)" value={l.nombre} onChange={(e) => set("links", editar<Link>(d.links, i, { nombre: e.target.value }))} />
                <input className={campo} placeholder="https://…" value={l.url} onChange={(e) => set("links", editar<Link>(d.links, i, { url: e.target.value }))} />
                <button type="button" aria-label="Quitar link" className="justify-self-end p-2 text-muted-foreground hover:text-destructive" onClick={() => set("links", d.links.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => set("links", [...d.links, { nombre: "", url: "" }])}>
              <Plus className="h-3.5 w-3.5" /> Agregar link
            </Button>
          </div>
        </Seccion>

        <Seccion titulo="Notas" ayuda="Cualquier otra cosa cierta hoy que la IA tenga que saber (ej: «esta semana no hay langostino»).">
          <textarea rows={3} className={campo} value={d.notas} onChange={(e) => set("notas", e.target.value)} />
        </Seccion>
      </div>
    </Card>
  )
}

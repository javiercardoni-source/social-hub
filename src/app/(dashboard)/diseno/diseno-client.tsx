"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Download, Loader2, Plus, Printer, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { borrarFormato, borrarPieza, crearFormato, crearPieza } from "@/lib/cos/impresion-actions"
import { explicarError } from "@/lib/ui-errors"
import { cn } from "@/lib/utils"

export type FormatoUI = { id: string; nombre: string; ancho_mm: number; alto_mm: number; sangrado_mm: number; dpi: number; px: string }
export type PiezaUI = {
  id: string
  formato: FormatoUI | null
  plantilla: string
  campos: Record<string, string>
  estado: "armando" | "lista" | "error"
  url: string | null
  descarga: string | null
  aviso: string | null
  error: string | null
}
type PlantillaUI = { id: string; nombre: string; para: string; fotos: number; campos: { clave: string; max: number; ayuda: string; opcional?: boolean }[] }
type FotoUI = { versionId: string; thumb: string | null; descripcion: string }

const cm = (mm: number) => `${(mm / 10).toLocaleString("es-AR")}`
const input = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"

const ESQUINAS = [
  ["abajo_derecha", "Abajo der."],
  ["abajo_izquierda", "Abajo izq."],
  ["arriba_derecha", "Arriba der."],
  ["arriba_izquierda", "Arriba izq."],
] as const

export function DisenoGrafico(props: {
  marca: string
  formatos: FormatoUI[]
  piezas: PiezaUI[]
  plantillas: PlantillaUI[]
  fotos: FotoUI[]
  sugeridos: { linea: string; pie: string; qrWhatsapp: string | null; qrWeb: string | null }
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [formatoId, setFormatoId] = useState(props.formatos[0]?.id ?? "")
  const [plantillaId, setPlantillaId] = useState(props.plantillas[0]?.id ?? "")
  const [foto, setFoto] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({ linea: props.sugeridos.linea, pie: props.sugeridos.pie })
  const [nuevo, setNuevo] = useState<{ abierto: boolean; nombre: string; ancho: string; alto: string; sangrado: string }>({ abierto: false, nombre: "", ancho: "", alto: "", sangrado: "3" })
  const pl = props.plantillas.find((p) => p.id === plantillaId)
  // QR opcional en cualquier plantilla (el imán ya trae el suyo, al WhatsApp del número).
  const [qr, setQr] = useState<{ on: boolean; destino: "whatsapp" | "web" | "otro"; otro: string; esquina: string }>({
    on: false,
    destino: props.sugeridos.qrWhatsapp ? "whatsapp" : props.sugeridos.qrWeb ? "web" : "otro",
    otro: "",
    esquina: "abajo_derecha",
  })
  const qrLink = qr.destino === "whatsapp" ? props.sugeridos.qrWhatsapp : qr.destino === "web" ? props.sugeridos.qrWeb : qr.otro.trim()
  const conQr = pl?.id !== "imp_pedido" && qr.on

  // Mientras alguna pieza se arma, la pantalla se actualiza sola.
  const armando = props.piezas.some((p) => p.estado === "armando")
  useEffect(() => {
    if (!armando) return
    const t = setInterval(() => router.refresh(), 5000)
    return () => clearInterval(t)
  }, [armando, router])

  function run(fn: () => Promise<void>, ok?: string) {
    setMsg(null)
    start(async () => {
      try {
        await fn()
        if (ok) setMsg(ok)
        router.refresh()
      } catch (e) {
        setMsg(explicarError(e))
      }
    })
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        {/* Formatos: los carga Javier */}
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">1 · Formato</h2>
            <button type="button" onClick={() => setNuevo((n) => ({ ...n, abierto: !n.abierto }))} className="flex items-center gap-1 text-xs font-semibold text-primary">
              {nuevo.abierto ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {nuevo.abierto ? "Cerrar" : "Agregar medida"}
            </button>
          </div>
          {nuevo.abierto && (
            <form
              className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-3"
              onSubmit={(e) => {
                e.preventDefault()
                run(async () => {
                  await crearFormato({ nombre: nuevo.nombre, ancho_cm: Number(nuevo.ancho.replace(",", ".")), alto_cm: Number(nuevo.alto.replace(",", ".")), sangrado_mm: Number(nuevo.sangrado.replace(",", ".")) })
                  setNuevo({ abierto: false, nombre: "", ancho: "", alto: "", sangrado: "3" })
                }, "Medida guardada")
              }}
            >
              <input className={cn(input, "col-span-2")} placeholder="Nombre (ej. Bolsa kraft mediana)" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
              <label className="text-xs text-muted-foreground">
                Ancho (cm)
                <input className={input} inputMode="decimal" value={nuevo.ancho} onChange={(e) => setNuevo({ ...nuevo, ancho: e.target.value })} />
              </label>
              <label className="text-xs text-muted-foreground">
                Alto (cm)
                <input className={input} inputMode="decimal" value={nuevo.alto} onChange={(e) => setNuevo({ ...nuevo, alto: e.target.value })} />
              </label>
              <label className="text-xs text-muted-foreground">
                Sangrado (mm)
                <input className={input} inputMode="decimal" value={nuevo.sangrado} onChange={(e) => setNuevo({ ...nuevo, sangrado: e.target.value })} />
              </label>
              <Button type="submit" size="sm" className="self-end" disabled={pending}>
                Guardar
              </Button>
              <p className="col-span-2 text-[11px] text-muted-foreground">El sangrado es el borde extra que corta la imprenta (lo normal es 3 mm). La resolución se elige sola según el tamaño.</p>
            </form>
          )}
          <div className="flex flex-wrap gap-2">
            {props.formatos.map((f) => (
              <span key={f.id} className={cn("group flex items-center gap-1 rounded-full border text-xs font-semibold", formatoId === f.id ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
                <button type="button" className="py-1.5 pl-3" onClick={() => setFormatoId(f.id)} title={`${f.px} · ${f.dpi} dpi · sangrado ${f.sangrado_mm} mm`}>
                  {f.nombre} <span className="font-normal opacity-70">· {cm(f.ancho_mm)} × {cm(f.alto_mm)} cm</span>
                </button>
                <button type="button" aria-label={`Borrar ${f.nombre}`} className="rounded-full p-1.5 pr-2 opacity-50 hover:opacity-100" onClick={() => confirm(`¿Borrar la medida «${f.nombre}»?`) && run(() => borrarFormato(f.id))}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {!props.formatos.length && <p className="text-xs text-muted-foreground">Todavía no hay medidas: agregá la primera.</p>}
          </div>
        </Card>

        {/* Plantilla y textos */}
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">2 · Plantilla y textos</h2>
          <div className="flex flex-wrap gap-1.5">
            {props.plantillas.map((p) => (
              <button key={p.id} type="button" title={p.para} onClick={() => setPlantillaId(p.id)} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", plantillaId === p.id ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
                {p.nombre}
              </button>
            ))}
          </div>
          {pl && <p className="text-xs text-muted-foreground">{pl.para}</p>}
          {pl?.campos.map((c) => (
            <label key={c.clave} className="block text-xs text-muted-foreground">
              {c.ayuda}
              {c.opcional ? " (opcional)" : ""}
              <input className={input} maxLength={c.max} value={campos[c.clave] ?? ""} onChange={(e) => setCampos({ ...campos, [c.clave]: e.target.value })} />
            </label>
          ))}
          {pl?.id === "imp_pedido" ? (
            <p className="text-[11px] text-muted-foreground">El QR abre el chat de WhatsApp de ese número. Sin precios: la pieza dura meses.</p>
          ) : (
            <div className="space-y-2 rounded-xl bg-muted/50 p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                <input type="checkbox" className="h-4 w-4" checked={qr.on} onChange={(e) => setQr({ ...qr, on: e.target.checked })} /> Agregar QR
              </label>
              {qr.on && (
                <>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {props.sugeridos.qrWhatsapp && (
                      <button type="button" onClick={() => setQr({ ...qr, destino: "whatsapp" })} className={cn("rounded-full border px-2.5 py-1 font-semibold", qr.destino === "whatsapp" ? "border-primary bg-primary/10 text-primary" : "bg-background")}>
                        WhatsApp de la marca
                      </button>
                    )}
                    {props.sugeridos.qrWeb && (
                      <button type="button" onClick={() => setQr({ ...qr, destino: "web" })} className={cn("rounded-full border px-2.5 py-1 font-semibold", qr.destino === "web" ? "border-primary bg-primary/10 text-primary" : "bg-background")}>
                        Web
                      </button>
                    )}
                    <button type="button" onClick={() => setQr({ ...qr, destino: "otro" })} className={cn("rounded-full border px-2.5 py-1 font-semibold", qr.destino === "otro" ? "border-primary bg-primary/10 text-primary" : "bg-background")}>
                      Otro link
                    </button>
                  </div>
                  {qr.destino === "otro" && <input className={input} placeholder="https://… (menú, Instagram, reseñas)" value={qr.otro} onChange={(e) => setQr({ ...qr, otro: e.target.value })} />}
                  {qrLink && <p className="truncate text-[11px] text-muted-foreground">Lleva a: {qrLink}</p>}
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {ESQUINAS.map(([id, label]) => (
                      <button key={id} type="button" onClick={() => setQr({ ...qr, esquina: id })} className={cn("rounded-full border px-2.5 py-1 font-semibold", qr.esquina === id ? "border-primary bg-primary/10 text-primary" : "bg-background")}>
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </Card>

        {/* Foto */}
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">3 · Foto</h2>
          {props.fotos.length ? (
            <div className="grid max-h-80 grid-cols-4 gap-1.5 overflow-y-auto pr-1">
              {props.fotos.map((f) => (
                <button key={f.versionId} type="button" title={f.descripcion} onClick={() => setFoto(f.versionId)} className={cn("relative aspect-square overflow-hidden rounded-lg bg-muted", foto === f.versionId && "ring-2 ring-primary ring-offset-2")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {f.thumb && <img src={f.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No hay fotos elegidas de esta marca: usá alguna desde Biblioteca.</p>
          )}
          <Button
            className="w-full"
            disabled={pending || !formatoId || !pl || (!!pl.fotos && !foto) || (conQr && !qrLink)}
            onClick={() =>
              run(
                () => crearPieza({ formatId: formatoId, plantilla: plantillaId, campos, versionId: foto, qr: conQr && qrLink ? { link: qrLink, esquina: qr.esquina } : null }),
                "Armando la pieza: aparece a la derecha en unos segundos",
              )
            }
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Armar pieza para imprenta
          </Button>
          {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        </Card>
      </div>

      {/* Piezas armadas */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Piezas de {props.marca}</h2>
        {!props.piezas.length && <p className="rounded-xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">Todavía no armaste ninguna. Elegí formato, plantilla y foto.</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {props.piezas.map((p) => {
            const f = p.formato
            // La línea de corte, sobre la vista previa (el archivo trae el sangrado alrededor).
            const sx = f ? (f.sangrado_mm / (f.ancho_mm + 2 * f.sangrado_mm)) * 100 : 0
            const sy = f ? (f.sangrado_mm / (f.alto_mm + 2 * f.sangrado_mm)) * 100 : 0
            const nombre = props.plantillas.find((x) => x.id === p.plantilla)?.nombre ?? p.plantilla
            return (
              <Card key={p.id} className="flex flex-col overflow-hidden">
                <div className="relative bg-muted" style={{ aspectRatio: f ? `${f.ancho_mm + 2 * f.sangrado_mm} / ${f.alto_mm + 2 * f.sangrado_mm}` : "4 / 5" }}>
                  {p.url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt="" className="absolute inset-0 h-full w-full object-contain" />
                  )}
                  {p.url && sx > 0 && <span className="pointer-events-none absolute border border-dashed border-white/80 mix-blend-difference" style={{ left: `${sx}%`, right: `${sx}%`, top: `${sy}%`, bottom: `${sy}%` }} />}
                  {p.estado === "armando" && (
                    <span className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Armando…
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-3 text-xs">
                  <p className="font-semibold">
                    {f ? `${f.nombre} · ${cm(f.ancho_mm)} × ${cm(f.alto_mm)} cm` : "Formato borrado"} <span className="font-normal text-muted-foreground">· {nombre}</span>
                  </p>
                  {f && <p className="text-muted-foreground">JPG {f.px} a {f.dpi} dpi, con {f.sangrado_mm} mm de sangrado (la línea punteada es el corte)</p>}
                  {p.aviso && <p className="rounded bg-amber-50 px-2 py-1 text-amber-800">⚠ {p.aviso}</p>}
                  {p.estado === "error" && <p className="rounded bg-red-50 px-2 py-1 text-red-700">No se pudo armar: {p.error}</p>}
                  <div className="mt-auto flex gap-2 pt-1">
                    {p.descarga && (
                      <a href={p.descarga} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
                        <Download className="h-3.5 w-3.5" /> Descargar JPG
                      </a>
                    )}
                    <Button size="sm" variant="outline" className="h-8" disabled={pending} aria-label="Borrar pieza" onClick={() => confirm("¿Borrar esta pieza?") && run(() => borrarPieza(p.id))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}

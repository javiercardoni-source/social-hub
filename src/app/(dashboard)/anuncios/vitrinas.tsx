"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, Copy, ExternalLink, Loader2, Plus, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { aprobarVitrina, armarVitrina, editarVitrina, rearmarVitrina } from "@/lib/cos/vitrina-actions"
import { explicarError } from "@/lib/ui-errors"
import { cn } from "@/lib/utils"

export type VitrinaUI = {
  id: string
  titulo: string
  bajada: string
  estado: string
  origen: string
  error: string | null
  url: string
  creada: string
  turnos: string | null
  turnosError: string | null
  items: { id: string; nombre: string; tapa: string | null; compartidos: number; descargas: number; verIg: number }[]
  vistas: number
  equipo: { nombre: string; compartidos: number }[]
}

const ESTADO: Record<string, { t: string; c: string }> = {
  armando: { t: "Armando…", c: "bg-muted text-muted-foreground" },
  lista: { t: "Lista · falta aprobar", c: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  aprobada: { t: "Aprobada · vigente", c: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  retirada: { t: "Retirada", c: "bg-muted text-muted-foreground" },
  error: { t: "Falló", c: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
}

function useAccion() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
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
  return { pending, error, correr }
}

function Nueva() {
  const { pending, error, correr } = useAccion()
  const [id, setId] = useState("")
  const [titulo, setTitulo] = useState("")
  const [bajada, setBajada] = useState("")
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Armar una vitrina desde una campaña</CardTitle>
        <p className="text-sm text-muted-foreground">
          Pegá el ID de la campaña de Meta (columna «Identificador» del Administrador de anuncios). Las tandas del Motor de ADS arman su vitrina solas cuando quedan creadas en Meta.
        </p>
      </CardHeader>
      <CardContent className="grid gap-2 md:grid-cols-[1fr_1fr]">
        <input value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="ID de la campaña" className="rounded-lg border bg-background px-3 py-2 text-sm" />
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título (ej: Onigiris por WhatsApp)" maxLength={120} className="rounded-lg border bg-background px-3 py-2 text-sm" />
        <input value={bajada} onChange={(e) => setBajada(e.target.value)} placeholder="Bajada (opcional)" maxLength={400} className="rounded-lg border bg-background px-3 py-2 text-sm md:col-span-2" />
        <div className="flex items-center gap-2 md:col-span-2">
          <Button disabled={pending || !id} onClick={() => correr(() => armarVitrina(id, titulo, bajada))}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Armar vitrina
          </Button>
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

function Fila({ v }: { v: VitrinaUI }) {
  const { pending, error, correr } = useAccion()
  const [titulo, setTitulo] = useState(v.titulo)
  const [bajada, setBajada] = useState(v.bajada)
  const [copiado, setCopiado] = useState(false)
  const est = ESTADO[v.estado] ?? { t: v.estado, c: "bg-muted" }
  const cambiado = titulo !== v.titulo || bajada !== v.bajada
  const favorita = [...v.items].sort((a, b) => b.compartidos - a.compartidos)[0]
  return (
    <Card className={cn(v.estado === "retirada" && "opacity-60")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", est.c)}>{est.t}</span>
          <span className="text-xs text-muted-foreground">
            {v.origen === "motor" ? "De una tanda del Motor de ADS" : "De una campaña"} · {v.creada} · {v.vistas} visitas
          </span>
        </div>
        {v.estado !== "retirada" && (
          <div className="grid gap-2">
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} className="rounded-lg border bg-background px-3 py-2 text-sm font-semibold" aria-label="Título" />
            <input value={bajada} onChange={(e) => setBajada(e.target.value)} maxLength={400} placeholder="Bajada" className="rounded-lg border bg-background px-3 py-2 text-sm" aria-label="Bajada" />
          </div>
        )}
        {v.items.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {v.items.map((it) => (
              <figure key={it.id} className="w-24 space-y-1">
                {it.tapa ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.tapa} alt="" className="aspect-[9/16] w-24 rounded-lg object-cover" />
                ) : (
                  <div className="aspect-[9/16] w-24 rounded-lg bg-muted" />
                )}
                <figcaption className="text-[11px] leading-tight text-muted-foreground">
                  <span className="block truncate font-semibold text-foreground">{it.nombre}</span>
                  {it.compartidos} compartidas · {it.descargas} descargas
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        {favorita && favorita.compartidos > 0 && <p className="text-sm">La favorita del equipo: <b>{favorita.nombre}</b> ({favorita.compartidos} veces compartida).</p>}
        {v.equipo.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Equipo: {v.equipo.map((p) => `${p.nombre.split(" ")[0]} ${p.compartidos}`).join(" · ")}
          </p>
        )}
        {v.error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">{v.error}</p>}
        {v.turnosError && <p className="text-xs text-red-700">Turnos: {v.turnosError}</p>}
        {v.turnos && <p className="text-xs text-muted-foreground">El equipo la recibió en Turnos el {v.turnos}.</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {["lista", "aprobada"].includes(v.estado) && (
            <>
              <Button variant="outline" size="sm" asChild>
                <a href={v.url} target="_blank" rel="noopener">
                  <ExternalLink className="h-3.5 w-3.5" /> Abrir
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(v.url)
                  setCopiado(true)
                }}
              >
                <Copy className="h-3.5 w-3.5" /> {copiado ? "Copiado" : "Copiar link"}
              </Button>
            </>
          )}
          {cambiado && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => correr(() => editarVitrina(v.id, titulo, bajada))}>
              Guardar textos
            </Button>
          )}
          {v.estado === "lista" && (
            <Button size="sm" disabled={pending} onClick={() => correr(() => aprobarVitrina(v.id))}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Aprobar y avisar al equipo
            </Button>
          )}
          {["lista", "aprobada", "error"].includes(v.estado) && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => correr(() => rearmarVitrina(v.id))}>
              <RotateCcw className="h-3.5 w-3.5" /> Rearmar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function Vitrinas({ vitrinas, linkFijo }: { vitrinas: VitrinaUI[]; linkFijo: string }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Link fijo de la marca (siempre muestra la vigente): <a href={linkFijo} target="_blank" rel="noopener" className="font-semibold text-foreground underline">{linkFijo}</a>. Se guardan las últimas 6; al armar la séptima, la más vieja se retira y su link pasa a llevar a la vigente.
      </p>
      <Nueva />
      <div className="grid gap-4 lg:grid-cols-2">
        {vitrinas.map((v) => (
          <Fila key={v.id} v={v} />
        ))}
      </div>
    </div>
  )
}

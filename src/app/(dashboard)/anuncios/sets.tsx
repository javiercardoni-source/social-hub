"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, Copy, Download, Loader2, RotateCcw, Sparkles, Trash2, Video, ImageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { borrarSet, crearSet, rehacerSet, rehacerVersion } from "@/lib/cos/ad-sets-actions"
import { explicarError } from "@/lib/ui-errors"
import { cn } from "@/lib/utils"
import { avisosTexto, FUENTE_TEXTO, FUENTES_SET, type FormatoSet, type FuenteSet } from "../../../../shared/cos/ad-sets"

export type PiezaSetUI = { formato: string; tipo: "video" | "imagen"; url: string | null; descarga: string | null }
export type VersionSetUI = { id: string; numero: number; texto: string; copy: string | null; estado: string; error: string | null; piezas: PiezaSetUI[] }
export type SetUI = {
  id: string
  textos: string
  detalles: string | null
  versiones: number
  formato: FormatoSet
  fuentes: FuenteSet[]
  estado: string
  error: string | null
  motivo: string | null
  creado: string
  material: { thumb: string | null; tipo: "foto" | "video"; origen: string }[]
  items: VersionSetUI[]
}
export type MaterialOpcion = { origen: "instagram" | "archivo"; id: string; thumb: string | null; tipo: "foto" | "video"; etiqueta: string }

const ESTADO: Record<string, { t: string; c: string }> = {
  preparando: { t: "Eligiendo material y escribiendo…", c: "bg-muted text-muted-foreground" },
  armando: { t: "Armando las piezas…", c: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  lista: { t: "Listo para descargar", c: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  error: { t: "Falló", c: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
}

const FORMATOS: { k: FormatoSet; t: string }[] = [
  { k: "ambos", t: "Video e imagen" },
  { k: "video", t: "Solo video" },
  { k: "imagen", t: "Solo imagen" },
]

function Opcion({ activa, onClick, children, disabled }: { activa: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={activa}
      className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors", activa ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
    >
      {children}
    </button>
  )
}

/** Grilla para elegir a mano fotos y videos de Instagram o del Archivo. */
function Selector({ opciones, elegidos, onChange }: { opciones: MaterialOpcion[]; elegidos: string[]; onChange: (x: string[]) => void }) {
  const [origen, setOrigen] = useState<"instagram" | "archivo">("archivo")
  const lista = opciones.filter((o) => o.origen === origen)
  const clave = (o: MaterialOpcion) => `${o.origen}:${o.id}`
  const toggle = (k: string) => onChange(elegidos.includes(k) ? elegidos.filter((x) => x !== k) : elegidos.length >= 12 ? elegidos : [...elegidos, k])
  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Opcion activa={origen === "archivo"} onClick={() => setOrigen("archivo")}>Archivo ({opciones.filter((o) => o.origen === "archivo").length})</Opcion>
        <Opcion activa={origen === "instagram"} onClick={() => setOrigen("instagram")}>Instagram ({opciones.filter((o) => o.origen === "instagram").length})</Opcion>
        <span className="text-xs text-muted-foreground">{elegidos.length} elegido{elegidos.length === 1 ? "" : "s"} (máximo 12). El orden en que los tocás es el orden en el video.</span>
      </div>
      {lista.length === 0 ? (
        <p className="p-4 text-center text-sm text-muted-foreground">No hay {origen === "archivo" ? "fotos ni videos listos en el Archivo" : "publicaciones de Instagram"} de esta marca.</p>
      ) : (
        <div className="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6 lg:grid-cols-8">
          {lista.map((o) => {
            const k = clave(o)
            const n = elegidos.indexOf(k)
            return (
              <button key={k} type="button" onClick={() => toggle(k)} title={o.etiqueta} className={cn("relative aspect-square overflow-hidden rounded-lg border-2", n >= 0 ? "border-primary" : "border-transparent")}>
                {o.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.thumb} alt={o.etiqueta} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="h-full w-full bg-muted" />
                )}
                {o.tipo === "video" && <Video className="absolute bottom-1 left-1 h-3.5 w-3.5 text-white drop-shadow" />}
                {n >= 0 && <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{n + 1}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NuevoSet({ opciones }: { opciones: MaterialOpcion[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [textos, setTextos] = useState("")
  const [detalles, setDetalles] = useState("")
  const [versiones, setVersiones] = useState(3)
  const [formato, setFormato] = useState<FormatoSet>("ambos")
  const [fuentes, setFuentes] = useState<FuenteSet[]>(["instagram", "archivo"])
  const [elegidos, setElegidos] = useState<string[]>([])
  const avisos = useMemo(() => avisosTexto(textos), [textos])

  const enviar = () =>
    start(async () => {
      setError(null)
      setOk(false)
      try {
        await crearSet({
          textos,
          detalles,
          versiones,
          formato,
          fuentes,
          elegidos: elegidos.map((k) => {
            const [origen, id] = k.split(":")
            return { origen, id }
          }),
        })
        setTextos("")
        setDetalles("")
        setElegidos([])
        setOk(true)
        router.refresh()
      } catch (e) {
        setError(explicarError(e))
      }
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" /> Nuevo set
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Escribí lo que va sobre la pieza. La IA hace versiones, elige fotos y videos <strong>reales</strong> del producto y arma cada versión en 9:16 (historias y reels) y 4:5 (feed). Es para descargar: no se sube a Meta.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-1.5">
          <label htmlFor="set-textos" className="text-sm font-semibold">Texto sobre la pieza</label>
          <textarea
            id="set-textos"
            value={textos}
            onChange={(e) => setTextos(e.target.value)}
            rows={3}
            maxLength={300}
            disabled={pending}
            placeholder={"Puro salmón 40 piezas\nComé en casa"}
            className="rounded-lg border bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">Un renglón por idea. La versión 1 lleva este texto tal cual; las demás son variantes con los mismos datos.</p>
          {avisos.map((a) => (
            <p key={a} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">{a}</p>
          ))}
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="set-detalles" className="text-sm font-semibold">Detalles para la IA <span className="font-normal text-muted-foreground">(opcional)</span></label>
          <textarea
            id="set-detalles"
            value={detalles}
            onChange={(e) => setDetalles(e.target.value)}
            rows={4}
            maxLength={1500}
            disabled={pending}
            placeholder="Qué producto mostrar, para quién, qué tono, qué destacar. Ej: el combo de 40 piezas todo salmón; para pedir en casa un viernes a la noche; tono antojador; que se vea el salmón bien de cerca."
            className="rounded-lg border bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">La IA lo usa para elegir el material y para escribir las versiones y el texto de cada publicación.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">Versiones</p>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <Opcion key={n} activa={versiones === n} onClick={() => setVersiones(n)} disabled={pending}>{n}</Opcion>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">Formato</p>
            <div className="flex flex-wrap gap-2">
              {FORMATOS.map((f) => (
                <Opcion key={f.k} activa={formato === f.k} onClick={() => setFormato(f.k)} disabled={pending}>{f.t}</Opcion>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-semibold">De dónde sale el material</p>
          <div className="flex flex-wrap gap-2">
            {FUENTES_SET.map((f) => (
              <Opcion key={f} activa={fuentes.includes(f)} onClick={() => setFuentes(fuentes.includes(f) ? fuentes.filter((x) => x !== f) : [...fuentes, f])} disabled={pending}>
                {fuentes.includes(f) && <Check className="mr-1 inline h-3.5 w-3.5" />}
                {FUENTE_TEXTO[f]}
              </Opcion>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Lo que elegís a mano entra tal cual y primero; de Instagram y el Archivo la IA elige solo lo que muestra el producto, sin precio encima y sin nada hecho con IA.
          </p>
          {fuentes.includes("manual") && <Selector opciones={opciones} elegidos={elegidos} onChange={setElegidos} />}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {ok && <p className="text-sm text-emerald-700 dark:text-emerald-400">Pedido. Tarda unos minutos: aparece abajo a medida que se arma cada versión.</p>}
        <Button onClick={enviar} disabled={pending || textos.trim().length < 2 || !fuentes.length}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Armar set
        </Button>
      </CardContent>
    </Card>
  )
}

function CopiarTexto({ texto }: { texto: string }) {
  const [hecho, setHecho] = useState(false)
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 px-2 text-xs"
      onClick={() => {
        void navigator.clipboard.writeText(texto).then(() => {
          setHecho(true)
          setTimeout(() => setHecho(false), 1500)
        })
      }}
    >
      {hecho ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {hecho ? "Copiado" : "Copiar texto"}
    </Button>
  )
}

function Version({ v }: { v: VersionSetUI }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-muted-foreground">V{v.numero}</span>
        <span className="text-sm font-semibold">{v.texto.split("\n").join(" · ")}</span>
        {v.estado !== "lista" && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", (ESTADO[v.estado] ?? ESTADO.armando).c)}>{v.estado === "armando" ? "Armando…" : (ESTADO[v.estado]?.t ?? v.estado)}</span>}
      </div>
      {v.piezas.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {v.piezas.map((p) => (
            <figure key={`${p.formato}-${p.tipo}`} className="space-y-1">
              {p.url ? (
                p.tipo === "video" ? (
                  <video src={p.url} controls muted playsInline preload="metadata" className={cn("rounded-lg bg-black", p.formato === "4x5" ? "aspect-[4/5] w-32" : "aspect-[9/16] w-28")} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt={`Versión ${v.numero}, ${p.formato}`} className={cn("rounded-lg object-cover", p.formato === "4x5" ? "aspect-[4/5] w-32" : "aspect-[9/16] w-28")} />
                )
              ) : (
                <div className="flex h-40 w-28 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">sin vista previa</div>
              )}
              <figcaption className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  {p.tipo === "video" ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                  {p.formato.replace("x", ":")}
                </span>
                {p.descarga && (
                  <a href={p.descarga} className="flex items-center gap-0.5 font-semibold text-primary hover:underline">
                    <Download className="h-3 w-3" /> Bajar
                  </a>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {v.copy && (
        <div className="rounded-lg bg-muted/50 p-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground">Texto para la publicación</span>
            <CopiarTexto texto={v.copy} />
          </div>
          <p className="whitespace-pre-line text-sm">{v.copy}</p>
        </div>
      )}
      {v.error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-900 dark:bg-red-950 dark:text-red-200">{v.error}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {v.estado === "error" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null)
              try {
                await rehacerVersion(v.id)
                router.refresh()
              } catch (e) {
                setError(explicarError(e))
              }
            })
          }
        >
          <RotateCcw className="h-3.5 w-3.5" /> Volver a armar
        </Button>
      )}
    </div>
  )
}

function TarjetaSet({ s }: { s: SetUI }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const est = ESTADO[s.estado] ?? { t: s.estado, c: "bg-muted" }
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
  const listas = s.items.filter((v) => v.estado === "lista").length

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="whitespace-pre-line font-semibold">{s.textos}</p>
            {s.detalles && <p className="line-clamp-2 text-xs text-muted-foreground">{s.detalles}</p>}
            <p className="text-xs text-muted-foreground">
              {s.creado} · {s.versiones} versión{s.versiones > 1 ? "es" : ""} · {FORMATOS.find((f) => f.k === s.formato)?.t} · {s.fuentes.map((f) => FUENTE_TEXTO[f]).join(" + ")}
            </p>
          </div>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", est.c)}>
            {s.estado === "armando" && s.items.length ? `Armando… ${listas} de ${s.items.length}` : est.t}
          </span>
        </div>

        {s.material.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold text-muted-foreground">Material real que usó{s.motivo ? `: ${s.motivo}` : ""}</p>
            <div className="flex flex-wrap gap-1.5">
              {s.material.map((m, i) =>
                m.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={m.thumb} alt="" title={`${m.origen} · ${m.tipo}`} className="h-12 w-12 rounded-md object-cover" />
                ) : (
                  <div key={i} className="h-12 w-12 rounded-md bg-muted" title={`${m.origen} · ${m.tipo}`} />
                ),
              )}
            </div>
          </div>
        )}

        {s.material.length > 0 && s.material.length < Math.min(3, s.items.length) && (
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Encontró {s.material.length === 1 ? "un solo archivo" : `solo ${s.material.length} archivos`} donde se ve lo que pedís, así que las versiones se parecen. Para más variedad: subí más fotos de ese producto al Archivo, o rehacelo con «Lo elijo yo».
          </p>
        )}
        {s.error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">{s.error}</p>}
        {s.estado === "preparando" && <p className="text-sm text-muted-foreground">La IA está mirando el material y escribiendo las versiones…</p>}

        <div className="grid gap-3 xl:grid-cols-2">
          {s.items.map((v) => (
            <Version key={v.id} v={v} />
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {s.estado !== "preparando" && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => correr(() => rehacerSet(s.id))}>
              <RotateCcw className="h-3.5 w-3.5" /> Rehacer todo (otro material y otras versiones)
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (confirm("¿Borrar este set y sus archivos?")) correr(() => borrarSet(s.id))
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Borrar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function Sets({ sets, opciones }: { sets: SetUI[]; opciones: MaterialOpcion[] }) {
  const router = useRouter()
  // Mientras algo se arma, la pantalla se actualiza sola cada 15 s.
  const enCurso = sets.some((s) => s.estado === "preparando" || s.estado === "armando")
  useEffect(() => {
    if (!enCurso) return
    const t = setInterval(() => router.refresh(), 15_000)
    return () => clearInterval(t)
  }, [enCurso, router])

  return (
    <div className="space-y-4">
      <NuevoSet opciones={opciones} />
      {sets.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">Todavía no armaste ningún set para esta marca.</p>
      ) : (
        sets.map((s) => <TarjetaSet key={s.id} s={s} />)
      )}
    </div>
  )
}

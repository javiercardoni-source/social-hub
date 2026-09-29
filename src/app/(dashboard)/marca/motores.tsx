"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle, Circle, Loader2, RefreshCw, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/client"
import { borrarMotor, borrarMusica, prepararSubidaMotor, reanalizarReferencia, registrarMotor } from "@/lib/cos/motores-actions"
import { explicarError } from "@/lib/ui-errors"
import { validarArchivo, type KindMotor } from "../../../../shared/cos/motores"

export type Ficha = {
  resumen?: string
  ritmo?: string
  planos?: string[]
  movimientos?: string[]
  transiciones?: string[]
  texto_en_pantalla?: string
  tipografia?: string
  paleta?: string[]
  estructura?: string[]
  para_nuestras_piezas?: string[]
  evitar?: string[]
  medidas?: { duracion_s: number; cortes: number; toma_promedio_s: number } | null
}
export type Insumo = { id: string; kind: KindMotor; name: string; url: string | null; mime: string; note: string | null; status: string; analysis: Ficha | null; error: string | null }
export type Tema = { key: string; name: string; url: string | null }

const ACEPTA: Record<KindMotor, string> = {
  referencia: "video/mp4,video/quicktime,image/jpeg,image/png,image/webp",
  fuente_titulo: ".ttf,.otf,.woff",
  fuente_texto: ".ttf,.otf,.woff",
  logo: "image/png",
  musica: "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/aac,.mp3,.m4a,.wav,.aac",
}

/** Botón que abre el selector de archivos, sube directo a cos-media y registra. */
function Subir({ kind, etiqueta, multiple, note, onDone, variant = "outline" }: { kind: KindMotor; etiqueta: string; multiple?: boolean; note?: string; onDone: (msg: string) => void; variant?: "outline" | "default" }) {
  const ref = useRef<HTMLInputElement>(null)
  const [pending, start] = useTransition()
  const [progreso, setProgreso] = useState<string | null>(null)
  const router = useRouter()
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={ACEPTA[kind]}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ""
          if (!files.length) return
          start(async () => {
            const errores: string[] = []
            let ok = 0
            let rearmados = 0
            for (const [i, file] of files.entries()) {
              setProgreso(files.length > 1 ? `Subiendo ${i + 1} de ${files.length}…` : "Subiendo…")
              try {
                const problema = validarArchivo(kind, file.name, file.size)
                if (problema) throw new Error(problema)
                const prep = await prepararSubidaMotor({ kind, name: file.name, size: file.size })
                const { error } = await createClient().storage.from("cos-media").uploadToSignedUrl(prep.key, prep.token, file, { contentType: file.type || undefined })
                if (error) throw new Error(`No se pudo subir: ${error.message}`)
                const r = await registrarMotor({ kind, key: prep.key, name: file.name, size: file.size, note })
                rearmados = Math.max(rearmados, r.rearmados)
                ok++
              } catch (err) {
                errores.push(`${file.name}: ${explicarError(err)}`)
              }
            }
            setProgreso(null)
            const partes = [
              ok ? `${ok === 1 ? "Listo" : `${ok} subidos`}.` : "",
              kind === "referencia" && ok ? "La IA está armando la ficha de estilo (un minuto)." : "",
              rearmados ? `Se están rearmando ${rearmados} borradores con esto.` : "",
              ...errores,
            ]
            onDone(partes.filter(Boolean).join(" "))
            router.refresh()
          })
        }}
      />
      <Button size="sm" variant={variant} disabled={pending} onClick={() => ref.current?.click()}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {progreso ?? etiqueta}
      </Button>
    </>
  )
}

function Estado({ listo, opcional }: { listo: boolean; opcional?: string }) {
  return listo ? (
    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
      <CheckCircle className="h-4 w-4" /> Listo
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs font-semibold text-amber-700">
      <Circle className="h-4 w-4" /> {opcional ?? "Falta"}
    </span>
  )
}

function Lista({ titulo, items }: { titulo: string; items?: string[] }) {
  if (!items?.length) return null
  return (
    <div>
      <p className="font-semibold">{titulo}</p>
      <ul className="ml-4 list-disc text-muted-foreground">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  )
}

function FichaVista({ f }: { f: Ficha }) {
  return (
    <div className="space-y-2 text-xs leading-relaxed">
      {f.resumen && <p className="font-medium">{f.resumen}</p>}
      {f.medidas && (
        <p className="rounded bg-muted px-2 py-1 font-mono text-[11px]">
          {f.medidas.duracion_s} s · {f.medidas.cortes} cortes · toma promedio {f.medidas.toma_promedio_s} s (medido)
        </p>
      )}
      {f.ritmo && <p><b>Ritmo:</b> <span className="text-muted-foreground">{f.ritmo}</span></p>}
      {f.tipografia && <p><b>Tipografía:</b> <span className="text-muted-foreground">{f.tipografia}</span></p>}
      {f.texto_en_pantalla && <p><b>Texto en pantalla:</b> <span className="text-muted-foreground">{f.texto_en_pantalla}</span></p>}
      {!!f.paleta?.length && (
        <div className="flex items-center gap-1.5">
          <b>Paleta:</b>
          {f.paleta.map((c) => (
            <span key={c} title={c} className="h-4 w-4 rounded border" style={{ backgroundColor: c }} />
          ))}
        </div>
      )}
      <Lista titulo="Planos" items={f.planos} />
      <Lista titulo="Movimientos" items={f.movimientos} />
      <Lista titulo="Transiciones" items={f.transiciones} />
      <Lista titulo="Estructura" items={f.estructura} />
      <Lista titulo="Para nuestras piezas" items={f.para_nuestras_piezas} />
      <Lista titulo="Evitar" items={f.evitar} />
    </div>
  )
}

function Referencia({ r, onMsg }: { r: Insumo; onMsg: (m: string) => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [abierta, setAbierta] = useState(false)
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      try {
        await fn()
        router.refresh()
      } catch (e) {
        onMsg(explicarError(e))
      }
    })
  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <div className="flex gap-3 p-2.5">
        <div className="h-24 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
          {r.url &&
            (r.mime.startsWith("video/") ? (
              <video src={r.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.url} alt="" className="h-full w-full object-cover" />
            ))}
        </div>
        <div className="min-w-0 flex-1 space-y-1 text-xs">
          <p className="truncate font-semibold">{r.name}</p>
          {r.note && <p className="text-muted-foreground">Te gusta: {r.note}</p>}
          {r.status === "analizando" && (
            <p className="flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> La IA la está analizando…
            </p>
          )}
          {r.status === "error" && (
            <p className="flex items-center gap-1 text-destructive">
              <AlertTriangle className="h-3 w-3" /> No se pudo analizar: {r.error}
            </p>
          )}
          {r.status === "lista" && r.analysis && (
            <>
              <p className="line-clamp-2 text-muted-foreground">{r.analysis.resumen}</p>
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setAbierta((x) => !x)}>
                {abierta ? "Ocultar ficha de estilo" : "Ver ficha de estilo"}
              </button>
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {r.status !== "analizando" && (
            <button type="button" aria-label="Volver a analizar" disabled={pending} className="rounded p-1.5 text-muted-foreground hover:bg-muted" onClick={() => run(() => reanalizarReferencia(r.id))}>
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            aria-label="Borrar referencia"
            disabled={pending}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
            onClick={() => confirm("¿Borrar esta referencia?") && run(() => borrarMotor(r.id))}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {abierta && r.analysis && (
        <div className="border-t bg-muted/30 p-3">
          <FichaVista f={r.analysis} />
        </div>
      )}
    </div>
  )
}

function Seccion({ n, titulo, ayuda, listo, opcional, children }: { n: number; titulo: string; ayuda: string; listo: boolean; opcional?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b p-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold">
            {n}. {titulo}
          </p>
          <p className="text-xs text-muted-foreground">{ayuda}</p>
        </div>
        <Estado listo={listo} opcional={opcional} />
      </div>
      {children}
    </section>
  )
}

/**
 * Marca → Motores: todo lo que los motores visuales necesitan de la marca, con su estado.
 * Nada es obligatorio para seguir publicando: lo que falta se reemplaza por lo de siempre.
 */
export function Motores({ brandName, insumos, musica }: { brandName: string; insumos: Insumo[]; musica: Tema[] }) {
  const router = useRouter()
  const [msg, setMsg] = useState<string | null>(null)
  const [nota, setNota] = useState("")
  const [pending, start] = useTransition()
  const refs = insumos.filter((i) => i.kind === "referencia")
  const titulo = insumos.find((i) => i.kind === "fuente_titulo")
  const texto = insumos.find((i) => i.kind === "fuente_texto")
  const logo = insumos.find((i) => i.kind === "logo")
  const analizando = refs.some((r) => r.status === "analizando")
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      try {
        const r = (await fn()) as { rearmados?: number } | undefined
        setMsg(r?.rearmados ? `Listo. Se están rearmando ${r.rearmados} borradores.` : "Listo.")
        router.refresh()
      } catch (e) {
        setMsg(explicarError(e))
      }
    })

  const archivo = (i: Insumo | undefined, kind: KindMotor, etiqueta: string) =>
    i ? (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-lg border bg-background px-2.5 py-1 font-medium">{i.name}</span>
        <Subir kind={kind} etiqueta="Reemplazar" onDone={setMsg} />
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm("¿Volver a la de siempre?") && run(() => borrarMotor(i.id))}>
          Volver a la de siempre
        </Button>
      </div>
    ) : (
      <div className="flex flex-wrap items-center gap-2">
        <Subir kind={kind} etiqueta={etiqueta} onDone={setMsg} />
        <span className="text-xs text-muted-foreground">o seguí sin: se usa la de siempre.</span>
      </div>
    )

  return (
    <Card className="flex min-h-[70vh] flex-col overflow-hidden">
      <div className="border-b px-4 py-3">
        <p className="font-bold">Motores visuales · {brandName}</p>
        <p className="text-xs text-muted-foreground">
          Lo que usan las plantillas y el futuro motor de edición. Nada es obligatorio: lo que falte se reemplaza por lo de siempre.
        </p>
      </div>
      {msg && <p className="mx-4 mt-3 rounded-lg bg-muted px-3 py-2 text-sm">{msg}</p>}
      {analizando && <AutoRefresco />}

      <div className="flex-1 overflow-y-auto">
        <Seccion
          n={1}
          titulo="Referencias de estilo"
          ayuda="Videos y placas (de cualquier cuenta) con el estilo que te gusta: cortes, tomas, acercamientos, gráfica, tipografía. La IA arma una ficha de cada una. Hasta 48 MB: si el video es largo, recortá la parte que te gusta."
          listo={refs.some((r) => r.status === "lista")}
          opcional={refs.length ? "Analizando" : "Falta"}
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Opcional: qué te gusta (ej: los cortes rápidos al ritmo, el texto grande)"
              className="min-w-[240px] flex-1 rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/40"
            />
            <Subir kind="referencia" etiqueta="Subir referencias" multiple note={nota} variant="default" onDone={(m) => (setMsg(m), setNota(""))} />
          </div>
          {refs.length > 0 && (
            <div className="grid gap-2 xl:grid-cols-2">
              {refs.map((r) => (
                <Referencia key={r.id} r={r} onMsg={setMsg} />
              ))}
            </div>
          )}
        </Seccion>

        <Seccion
          n={2}
          titulo="Tipografía de títulos"
          ayuda="La letra exacta de la marca para las frases sobre la imagen (TTF, OTF o WOFF). Si no la tenés, seguí sin: se usa una gratuita parecida."
          listo={!!titulo}
          opcional="Opcional"
        >
          {archivo(titulo, "fuente_titulo", "Subir tipografía de títulos")}
        </Seccion>

        <Seccion n={3} titulo="Tipografía de textos" ayuda="La letra para textos chicos (el nombre de la marca, datos). TTF, OTF o WOFF." listo={!!texto} opcional="Opcional">
          {archivo(texto, "fuente_texto", "Subir tipografía de textos")}
        </Seccion>

        <Seccion
          n={4}
          titulo="Logo"
          ayuda="PNG con fondo transparente, buena resolución (al menos 600 px de ancho). Reemplaza al que usan hoy las plantillas."
          listo={!!logo}
          opcional="Opcional"
        >
          {archivo(logo, "logo", "Subir logo (PNG)")}
        </Seccion>

        <Seccion
          n={5}
          titulo="Biblioteca de sonido"
          ayuda="Los temas de esta marca (MP3, M4A, WAV). La IA elige de acá la música de reels e historias. Con licencia de uso libre (ej. Pixabay)."
          listo={musica.length > 0}
        >
          <Subir kind="musica" etiqueta="Subir temas" multiple onDone={setMsg} />
          {musica.length > 0 && (
            <div className="flex flex-col gap-1">
              {musica.map((m) => (
                <div key={m.key} className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-xs">
                  <span className="flex-1 truncate font-medium capitalize">{m.name}</span>
                  {m.url && <audio src={m.url} controls preload="none" className="h-7 w-40 sm:w-56" />}
                  <button
                    type="button"
                    aria-label={`Sacar ${m.name}`}
                    disabled={pending}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                    onClick={() => confirm(`¿Sacar «${m.name}» de la biblioteca?`) && run(() => borrarMusica(m.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Seccion>
      </div>
    </Card>
  )
}

/** Mientras la IA analiza referencias, la pantalla se actualiza sola cada 10 s. */
function AutoRefresco() {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 10_000)
    return () => clearInterval(t)
  }, [router])
  return null
}

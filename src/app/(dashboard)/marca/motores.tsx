"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle, Circle, Loader2, Play, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/client"
import { borrarMotor, borrarMusica, etiquetarTema, prepararSubidaMotor, reanalizarReferencia, registrarMotor } from "@/lib/cos/motores-actions"
import { explicarError } from "@/lib/ui-errors"
import { validarArchivo, type KindMotor } from "../../../../shared/cos/motores"
import { GENEROS, GENERO_LABEL, MOODS, MOOD_LABEL, type EtiquetasTema, type Genero, type Mood } from "../../../../shared/cos/gustos"

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
/** Ficha de un tema (F7): lo medido por el worker + lo marcado a mano. */
export type FichaTema = EtiquetasTema & { id: string; duracion: number | null; bpm: number | null; energia: number | null; estado: "midiendo" | "lista" | "error" }
export type Tema = { key: string; name: string; url: string | null; ficha: FichaTema | null }

const ACEPTA: Record<KindMotor, string> = {
  referencia: "video/mp4,video/quicktime,image/jpeg,image/png,image/webp",
  fuente_titulo: ".ttf,.otf,.woff",
  fuente_texto: ".ttf,.otf,.woff",
  logo: "image/png",
  musica: "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/aac,.mp3,.m4a,.wav,.aac",
}

/** Botón que abre el selector de archivos, sube directo a cos-media y registra. */
function Subir({ kind, etiqueta, multiple, note, onDone, variant = "outline", tile }: { kind: KindMotor; etiqueta: string; multiple?: boolean; note?: string; onDone: (msg: string) => void; variant?: "outline" | "default"; tile?: boolean }) {
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
      {tile ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => ref.current?.click()}
          className="flex aspect-square flex-col items-center justify-center gap-1 bg-muted text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          {pending ? <Loader2 className="h-7 w-7 animate-spin" /> : <Plus className="h-8 w-8" />}
          <span className="px-2 text-center text-[11px] font-semibold">{progreso ?? etiqueta}</span>
        </button>
      ) : (
        <Button size="sm" variant={variant} disabled={pending} onClick={() => ref.current?.click()}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {progreso ?? etiqueta}
        </Button>
      )}
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

/**
 * Referencias como el feed de un perfil de Instagram: grilla de 3 columnas, lo más nuevo
 * primero, un cuadro «+» para agregar y ✕ para sacar. Tocando una se ve grande con su ficha.
 */
function FeedReferencias({ brandName, refs, nota, onMsg }: { brandName: string; refs: Insumo[]; nota: string; onMsg: (m: string) => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [abierta, setAbierta] = useState<string | null>(null)
  const r = refs.find((x) => x.id === abierta) ?? null
  const run = (fn: () => Promise<unknown>, after?: () => void) =>
    start(async () => {
      try {
        await fn()
        after?.()
        router.refresh()
      } catch (e) {
        onMsg(explicarError(e))
      }
    })
  const borrar = (x: Insumo) => confirm(`¿Sacar «${x.name}» de las referencias?`) && run(() => borrarMotor(x.id), () => setAbierta(null))

  return (
    <div className="mx-auto w-full max-w-xl overflow-hidden rounded-2xl border bg-background">
      {/* Cabecera de perfil */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-[2px]">
          <div className="flex h-full w-full items-center justify-center rounded-full bg-background text-sm font-extrabold">{brandName.slice(0, 1)}</div>
        </div>
        <div className="text-sm">
          <p className="font-semibold">{brandName} · estilo</p>
          <p className="text-xs text-muted-foreground">
            {refs.length} referencias · {refs.filter((x) => x.status === "lista").length} con ficha
          </p>
        </div>
      </div>

      {/* Grilla */}
      <div className="grid grid-cols-3 gap-0.5 bg-border">
        <Subir kind="referencia" etiqueta="Agregar" multiple note={nota} tile onDone={onMsg} />
        {refs.map((x) => (
          <div key={x.id} className="group relative aspect-square bg-muted">
            <button type="button" onClick={() => setAbierta(x.id)} className="block h-full w-full" aria-label={`Ver ${x.name}`}>
              {x.url &&
                (x.mime.startsWith("video/") ? (
                  <video src={x.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={x.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                ))}
            </button>
            {x.mime.startsWith("video/") && <Play className="pointer-events-none absolute left-1.5 top-1.5 h-4 w-4 fill-white text-white drop-shadow" />}
            {x.status === "analizando" && (
              <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                <Loader2 className="h-3 w-3 animate-spin" /> analizando
              </span>
            )}
            {x.status === "error" && (
              <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">sin ficha</span>
            )}
            <button
              type="button"
              aria-label={`Sacar ${x.name}`}
              disabled={pending}
              onClick={() => borrar(x)}
              className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white opacity-90 transition hover:bg-red-600 sm:opacity-0 sm:group-hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Detalle: la referencia grande con su ficha */}
      {r && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onClick={() => setAbierta(null)}>
          <div className="grid max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-background md:grid-cols-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-center bg-black">
              {r.url &&
                (r.mime.startsWith("video/") ? (
                  <video src={r.url} className="max-h-[50vh] w-full object-contain md:max-h-[92vh]" controls playsInline autoPlay muted loop />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.url} alt="" className="max-h-[50vh] w-full object-contain md:max-h-[92vh]" />
                ))}
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="flex items-start justify-between gap-2 border-b p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{r.name}</p>
                  {r.note && <p className="text-xs text-muted-foreground">Te gusta: {r.note}</p>}
                </div>
                <button type="button" aria-label="Cerrar" className="rounded p-1 hover:bg-muted" onClick={() => setAbierta(null)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {r.status === "analizando" && (
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> La IA está armando la ficha de estilo…
                  </p>
                )}
                {r.status === "error" && (
                  <p className="flex items-center gap-1.5 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4" /> No se pudo analizar: {r.error}
                  </p>
                )}
                {r.status === "lista" && r.analysis && <FichaVista f={r.analysis} />}
              </div>
              <div className="flex gap-2 border-t p-3">
                {r.status !== "analizando" && (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reanalizarReferencia(r.id))}>
                    <RefreshCw className="h-3.5 w-3.5" /> Volver a analizar
                  </Button>
                )}
                <Button size="sm" variant="destructive" className="ml-auto" disabled={pending} onClick={() => borrar(r)}>
                  <Trash2 className="h-3.5 w-3.5" /> Sacar
                </Button>
              </div>
            </div>
          </div>
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
  const analizando = refs.some((r) => r.status === "analizando") || musica.some((m) => !m.ficha || m.ficha.estado === "midiendo")
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
              placeholder="Opcional, antes de agregar: qué te gusta (ej: los cortes rápidos, el texto grande)"
              className="min-w-[240px] flex-1 rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <FeedReferencias brandName={brandName} refs={refs} nota={nota} onMsg={(m) => (setMsg(m), setNota(""))} />
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
          ayuda="Los temas de esta marca (MP3, M4A, WAV). De acá sale la música de reels e historias. Con licencia de uso libre (ej. Pixabay). Duración, BPM y energía se miden solos; marcá género, mood y voz con los chips: con eso el motor aprende qué música le gusta a tu público."
          listo={musica.length > 0}
        >
          <Subir kind="musica" etiqueta="Subir temas" multiple onDone={setMsg} />
          {musica.length > 0 && (
            <div className="flex flex-col gap-2">
              {musica.map((m) => (
                <div key={m.key} className="rounded-lg border bg-background px-2.5 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium capitalize">{m.name}</span>
                    {m.url && <audio src={m.url} controls preload="none" className="h-8 w-full sm:w-56" />}
                    <button
                      type="button"
                      aria-label={`Sacar ${m.name}`}
                      disabled={pending}
                      className="ml-auto rounded p-2 text-muted-foreground hover:bg-muted hover:text-destructive sm:ml-0"
                      onClick={() => confirm(`¿Sacar «${m.name}» de la biblioteca?`) && run(() => borrarMusica(m.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <FichaDeTema ficha={m.ficha} onMsg={setMsg} />
                </div>
              ))}
            </div>
          )}
        </Seccion>
      </div>
    </Card>
  )
}

/**
 * Mientras la IA analiza referencias o el worker mide temas, la pantalla se actualiza sola cada
 * 10 s. Como mucho 10 minutos: si algo quedó trabado, no refresca para siempre (se ve al recargar).
 */
function AutoRefresco() {
  const router = useRouter()
  useEffect(() => {
    const desde = Date.now()
    const t = setInterval(() => {
      if (Date.now() - desde > 10 * 60_000) return clearInterval(t)
      router.refresh()
    }, 10_000)
    return () => clearInterval(t)
  }, [router])
  return null
}

/** "2:34" */
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`

/**
 * Ficha de un tema: lo medido (duración, BPM, energía) y los chips para marcar a mano género
 * (uno), mood (varios) y voz. Cada toque se guarda solo.
 */
function FichaDeTema({ ficha, onMsg }: { ficha: FichaTema | null; onMsg: (m: string) => void }) {
  const [et, setEt] = useState<EtiquetasTema | null>(ficha ? { genre: ficha.genre, mood: ficha.mood, vocals: ficha.vocals } : null)
  const [pending, start] = useTransition()
  if (!ficha || !et) return <p className="mt-1.5 text-muted-foreground">Registrando el tema…</p>

  const guardar = (nuevo: EtiquetasTema) => {
    const antes = et
    setEt(nuevo)
    start(async () => {
      try {
        setEt(await etiquetarTema(ficha.id, nuevo))
      } catch (e) {
        setEt(antes)
        onMsg(explicarError(e))
      }
    })
  }
  const medidas =
    ficha.estado === "midiendo"
      ? "Midiendo duración, BPM y energía…"
      : ficha.estado === "error"
        ? "No se pudo medir este tema"
        : [ficha.duracion != null ? mmss(ficha.duracion) : null, ficha.bpm != null ? `${ficha.bpm} BPM` : "BPM sin pulso claro", ficha.energia != null ? `energía ${Math.round(ficha.energia * 100)} %` : null]
            .filter(Boolean)
            .join(" · ")

  const chip = (activo: boolean, label: string, onClick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={activo}
      disabled={pending}
      onClick={onClick}
      className={`min-h-8 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${activo ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
    >
      {label}
    </button>
  )
  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className={`tabular-nums ${ficha.estado === "error" ? "text-amber-700" : "text-muted-foreground"}`}>{medidas}</p>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
        <span className="w-16 shrink-0 pt-1.5 font-semibold text-muted-foreground">Género</span>
        <div className="flex flex-wrap gap-1.5">
          {GENEROS.map((g: Genero) => chip(et.genre === g, GENERO_LABEL[g], () => guardar({ ...et, genre: et.genre === g ? null : g }), g))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
        <span className="w-16 shrink-0 pt-1.5 font-semibold text-muted-foreground">Mood</span>
        <div className="flex flex-wrap gap-1.5">
          {MOODS.map((m: Mood) =>
            chip(et.mood.includes(m), MOOD_LABEL[m], () => guardar({ ...et, mood: et.mood.includes(m) ? et.mood.filter((x) => x !== m) : [...et.mood, m] }), m),
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
        <span className="w-16 shrink-0 pt-1.5 font-semibold text-muted-foreground">Voz</span>
        <div className="flex flex-wrap gap-1.5">
          {chip(et.vocals === true, "Con voz", () => guardar({ ...et, vocals: et.vocals === true ? null : true }), "voz")}
          {chip(et.vocals === false, "Instrumental", () => guardar({ ...et, vocals: et.vocals === false ? null : false }), "inst")}
        </div>
      </div>
    </div>
  )
}

"use client"

import { explicarError } from "@/lib/ui-errors"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { aprobarPost, editarPost, rechazarPost, rehacerConIA } from "@/lib/cos/actions"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PlatformIcon } from "@/components/ui/platform-icon"
import { AlertTriangle, CheckCircle, Heart, Loader2, MessageCircle, Send, Bookmark, ThumbsUp, Share2, XCircle, CheckCheck, Sparkles, Volume2, VolumeX } from "lucide-react"
import { cn } from "@/lib/utils"

export type PostItem = {
  id: string
  caption: string
  hashtags: string
  platform: "instagram" | "facebook"
  postType: "feed" | "carousel" | "reel" | "story"
  scheduledAt: string | null
  overlayText: string
  musicKey: string | null
  position: "auto" | "top" | "bottom"
  qa: { ok?: boolean; tapa?: string; legible?: boolean; skipped?: string } | null
  suggestions: { at: string; label: string; lift: string; up: boolean; confianza: string }[]
  template: string
  renderUrl: string | null
  accountName: string
}

const TEMPLATES = [
  { id: "banda", label: "Banda", hint: "franja abajo con la frase y el logo" },
  { id: "etiqueta", label: "Etiqueta", hint: "la frase en un cartel arriba" },
  { id: "firma", label: "Firma", hint: "solo el logo en una esquina" },
  { id: "none", label: "Sin nada", hint: "la foto limpia" },
]

export type Grupo = {
  key: string
  brand: { name: string; color: string } | null
  mediaUrl: string | null
  isVideo: boolean
  width: number | null
  height: number | null
  description: string | null
  submittedBy: string | null
  quality: number | null
  riskFlags: string[]
  music: { key: string; name: string; url: string | null }[]
  createdAt: string
  posts: PostItem[]
}

const FLAG_TEXT: Record<string, string> = {
  imagen_generada_o_de_banco: "Parece una imagen generada o de banco, no sacada en la cocina",
  caras_de_clientes: "Aparecen caras que no parecen del equipo",
  menores: "Aparecen menores",
  marca_ajena: "Se ven logos de otras marcas",
  higiene: "Algo se ve fuera de norma de higiene",
  baja_calidad: "Calidad baja (foco, luz o encuadre)",
  texto_ilegible: "Tiene texto que no se lee bien",
}

function label(p: PostItem) {
  if (p.platform === "facebook") return p.postType === "reel" ? "Video de Facebook" : "Post de Facebook"
  return { feed: "Post de Instagram", reel: "Reel de Instagram", story: "Historia de Instagram", carousel: "Carrusel de Instagram" }[p.postType]
}

// ── Vista previa: mismo encuadre que arma el worker (sin recortar: relleno desenfocado) ──

function frameFor(p: PostItem, w: number | null, h: number | null): { ratio: number; fill: boolean } {
  const r = w && h ? w / h : 1
  if (p.postType === "story" || p.postType === "reel") return { ratio: 9 / 16, fill: r < 0.55 || r > 0.58 }
  if (p.platform === "instagram") {
    if (r >= 0.8 && r <= 1.91) return { ratio: r, fill: false }
    return { ratio: r < 0.8 ? 4 / 5 : 1.91, fill: true }
  }
  return { ratio: r, fill: false }
}

/**
 * Video de la vista previa con botón de sonido bien visible. Arranca silenciado porque el
 * navegador no deja reproducir con audio solo; un toque lo activa (y vuelve a empezar).
 */
function VideoConSonido({ src, className }: { src: string; className?: string }) {
  const [muted, setMuted] = useState(true)
  return (
    <>
      <video
        src={src}
        className={className}
        muted={muted}
        playsInline
        autoPlay
        loop
        ref={(v) => {
          if (v) v.muted = muted
        }}
      />
      <button
        type="button"
        onClick={(e) => {
          const v = e.currentTarget.previousElementSibling as HTMLVideoElement | null
          const next = !muted
          setMuted(next)
          if (v) {
            v.muted = next
            if (!next) {
              v.currentTime = 0
              void v.play()
            }
          }
        }}
        aria-label={muted ? "Activar sonido" : "Silenciar"}
        className="absolute bottom-[18%] right-3 z-40 flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur hover:bg-black/85"
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        {muted ? "Activar sonido" : "Con sonido"}
      </button>
    </>
  )
}

function Media({ g, p, ratio, fill }: { g: Grupo; p: PostItem; ratio: number; fill: boolean }) {
  // La pieza final que armó el worker: es exactamente lo que se publica.
  if (p.renderUrl) {
    // Un reel armado con una foto es video aunque el original sea foto.
    return /\.mp4(\?|$)/.test(p.renderUrl) ? (
      <div className="relative">
        <VideoConSonido src={p.renderUrl} className="block w-full" />
      </div>
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={p.renderUrl} alt="" className="block w-full" />
    )
  }
  if (!g.mediaUrl) {
    return <div className="flex items-center justify-center bg-neutral-200 text-xs text-neutral-500" style={{ aspectRatio: ratio }}>Sin archivo</div>
  }
  const fg = cn("absolute inset-0 h-full w-full", fill ? "object-contain" : "object-cover")
  return (
    <div className={cn("relative w-full overflow-hidden", g.isVideo && fill ? "bg-black" : "bg-neutral-100")} style={{ aspectRatio: ratio }}>
      {g.isVideo ? (
        <VideoConSonido src={g.mediaUrl} className={fg} />
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {fill && <img src={g.mediaUrl} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={g.mediaUrl} alt="" className={fg} />
        </>
      )}
    </div>
  )
}

function Avatar({ g, size = 30 }: { g: Grupo; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white"
      style={{ width: size, height: size, backgroundColor: g.brand?.color ?? "#999" }}
    >
      {g.brand?.name.slice(0, 1) ?? "·"}
    </div>
  )
}

function Preview({ g, p, caption, hashtags }: { g: Grupo; p: PostItem; caption: string; hashtags: string }) {
  const { ratio, fill } = frameFor(p, g.width, g.height)
  const handle = p.accountName.replace(/^@/, "")

  if (p.postType === "story") {
    return (
      <div className="relative overflow-hidden rounded-[22px] bg-black">
        <Media g={g} p={p} ratio={9 / 16} fill={fill} />
        <div className="absolute inset-x-3 top-2 h-0.5 rounded bg-white/60" />
        <div className="absolute left-3 top-4 flex items-center gap-2 text-xs font-semibold text-white drop-shadow">
          <Avatar g={g} size={26} /> {handle} <span className="font-normal opacity-80">ahora</span>
        </div>
      </div>
    )
  }

  if (p.platform === "facebook") {
    return (
      <div className="overflow-hidden rounded-[22px] bg-white text-[13px] text-neutral-900">
        <div className="flex items-center gap-2 p-3">
          <Avatar g={g} size={34} />
          <div>
            <p className="font-semibold leading-tight">{p.accountName}</p>
            <p className="text-[11px] text-neutral-500">Ahora · 🌐</p>
          </div>
        </div>
        <p className="whitespace-pre-wrap px-3 pb-2 leading-snug">
          {caption}
          {hashtags && <span className="text-[#385898]">{`\n\n${hashtags}`}</span>}
        </p>
        <Media g={g} p={p} ratio={ratio} fill={fill} />
        <div className="flex justify-around border-t py-2 text-[12px] font-semibold text-neutral-500">
          <span className="flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5" />Me gusta</span>
          <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />Comentar</span>
          <span className="flex items-center gap-1"><Share2 className="h-3.5 w-3.5" />Compartir</span>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[22px] bg-white text-[13px] text-neutral-900">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="rounded-full p-[2px]" style={{ background: "linear-gradient(45deg,#f58529,#dd2a7b,#8134af)" }}>
          <div className="rounded-full bg-white p-[1.5px]"><Avatar g={g} size={26} /></div>
        </div>
        <p className="font-semibold">{handle}</p>
      </div>
      <Media g={g} p={p} ratio={ratio} fill={fill} />
      <div className="flex items-center gap-3.5 px-3 pb-1 pt-2.5">
        <Heart className="h-5 w-5" /><MessageCircle className="h-5 w-5" /><Send className="h-5 w-5" /><Bookmark className="ml-auto h-5 w-5" />
      </div>
      <p className="whitespace-pre-wrap px-3 pb-3 leading-snug">
        <b>{handle}</b> {caption}
        {hashtags && <span className="text-[#00376b]">{`\n\n${hashtags}`}</span>}
      </p>
    </div>
  )
}

// ── Tarjeta por subida ──────────────────────────────────────────────────────

function toLocalInput(d: Date) {
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16)
}

function GrupoCard({ g }: { g: Grupo }) {
  const router = useRouter()
  const [active, setActive] = useState(g.posts[0]?.id)
  const [resuelto, setResuelto] = useState<Record<string, "aprobado" | "rechazado">>({})
  const [textos, setTextos] = useState(() =>
    Object.fromEntries(
      g.posts.map((p) => [
        p.id,
        { caption: p.caption, hashtags: p.hashtags, overlay: p.overlayText, template: p.template, music: p.musicKey, position: p.position },
      ]),
    ),
  )
  const [cuando, setCuando] = useState<"ya" | "programar">("ya")
  const [fecha, setFecha] = useState(() => toLocalInput(new Date(Date.now() + 24 * 3600_000)))
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [rehacer, setRehacer] = useState<{ open: boolean; pedido: string; diseno: boolean; musica: boolean; trabajando: boolean }>({
    open: false,
    pedido: "",
    diseno: false,
    musica: false,
    trabajando: false,
  })

  const pendientes = g.posts.filter((p) => !resuelto[p.id])
  const p = g.posts.find((x) => x.id === active) ?? g.posts[0]
  const t = textos[p.id]
  const changed = (x: PostItem) => {
    const tx = textos[x.id]
    return tx.caption !== x.caption || tx.hashtags !== x.hashtags || tx.overlay !== x.overlayText || tx.template !== x.template || tx.music !== x.musicKey || tx.position !== x.position
  }
  const editado = changed(p)
  const set = (patch: Partial<(typeof textos)[string]>) => setTextos((s) => ({ ...s, [p.id]: { ...s[p.id], ...patch } }))

  // Guarda y pide al worker la pieza nueva; la vista previa se actualiza sola en unos segundos.
  function verComoQueda() {
    run(async () => {
      await editarPost(p.id, t.caption, t.hashtags, t.overlay, t.template, t.music, t.position)
      for (const ms of [3000, 4000, 6000]) {
        await new Promise((r) => setTimeout(r, ms))
        router.refresh()
      }
    })
  }

  function run(fn: () => Promise<void>) {
    setError(null)
    start(async () => {
      try {
        await fn()
        router.refresh()
      } catch (e) {
        setError(explicarError(e))
      }
    })
  }

  const scheduled = () => (cuando === "ya" ? null : new Date(fecha).toISOString())

  async function aprobar(ids: string[]) {
    // Si la IA marcó que alguna pieza tapa algo, se pide confirmación (la decisión es de Javier).
    const conAviso = g.posts.filter((x) => ids.includes(x.id) && x.qa && !x.qa.skipped && x.qa.ok === false)
    if (conAviso.length && !confirm(`La IA detectó que ${conAviso.map((x) => `${label(x)} tapa ${x.qa?.tapa || "algo"}`).join("; ")}. ¿Aprobar igual?`)) return
    for (const id of ids) {
      const tx = textos[id]
      const orig = g.posts.find((x) => x.id === id)!
      if (changed(orig)) await editarPost(id, tx.caption, tx.hashtags, tx.overlay, tx.template, tx.music, tx.position)
      await aprobarPost(id, scheduled())
      setResuelto((r) => ({ ...r, [id]: "aprobado" }))
    }
    const next = g.posts.find((x) => !ids.includes(x.id) && !resuelto[x.id])
    if (next) setActive(next.id)
  }

  if (pendientes.length === 0) {
    const n = Object.values(resuelto).filter((v) => v === "aprobado").length
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-emerald-700">
        <CheckCircle className="h-4 w-4" />
        {n ? `${n} aprobada${n > 1 ? "s" : ""}: ${cuando === "ya" ? "salen en uno o dos minutos" : "quedan programadas"}. Seguilas en Calendario.` : "Rechazado."}
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Celular con la vista previa */}
        <div className="border-b bg-muted/40 p-4 lg:border-b-0 lg:border-r">
          <div className="mx-auto max-w-[300px] rounded-[30px] bg-neutral-900 p-2 shadow-lg">
            <Preview g={g} p={p} caption={t.caption} hashtags={t.hashtags} />
          </div>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            {p.renderUrl && !editado ? "Así va a salir (pieza final)" : editado ? "Tocá «Ver cómo queda» para actualizar" : "Vista aproximada: armando la pieza final…"}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-4 p-4 md:p-5">
          {/* Formatos */}
          <div className="flex flex-wrap gap-2">
            {g.posts.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setActive(x.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  x.id === p.id ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
                  resuelto[x.id] && "opacity-50",
                )}
              >
                <PlatformIcon platform={x.platform} className="h-3.5 w-3.5" />
                {label(x)}
                {resuelto[x.id] === "aprobado" && <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />}
                {resuelto[x.id] === "rechazado" && <XCircle className="h-3.5 w-3.5 text-red-500" />}
              </button>
            ))}
          </div>

          {/* Lo que mandó la cocina y alertas de la IA */}
          <div className="rounded-xl bg-muted/50 px-3 py-2 text-sm">
            <p className="text-muted-foreground">
              <b className="text-foreground">{g.submittedBy ?? "Alguien"}</b>
              {g.brand ? ` · ${g.brand.name}` : ""}: “{g.description}”
            </p>
            {g.riskFlags.map((f) => (
              <p key={f} className="mt-1 flex items-center gap-1.5 text-xs font-medium text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" /> {FLAG_TEXT[f] ?? f}
              </p>
            ))}
          </div>

          {/* Texto sobre la imagen y plantilla de marca */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Sobre la imagen</label>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((tp) => (
                <button
                  key={tp.id}
                  type="button"
                  title={tp.hint}
                  disabled={!!resuelto[p.id]}
                  onClick={() => set({ template: tp.id })}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold",
                    t.template === tp.id ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                  )}
                >
                  {tp.label}
                </button>
              ))}
            </div>
            {t.template !== "none" && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Posición:</span>
                {(
                  [
                    ["auto", "Automática (la IA elige)"],
                    ["top", "Arriba"],
                    ["bottom", "Abajo"],
                  ] as const
                ).map(([id, lbl]) => (
                  <button
                    key={id}
                    type="button"
                    disabled={!!resuelto[p.id]}
                    onClick={() => set({ position: id })}
                    className={cn("rounded-full border px-2.5 py-0.5 font-semibold", t.position === id ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            )}
            {p.renderUrl && !editado && p.qa && !p.qa.skipped && (
              <p className={cn("rounded-lg px-2.5 py-1.5 text-xs font-medium", p.qa.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>
                {p.qa.ok
                  ? "✓ Revisado por la IA: no tapa nada importante y se lee bien"
                  : `⚠ La IA detectó que ${p.qa.tapa ? `tapa ${p.qa.tapa}` : "no se lee bien"}. Probá otra posición, otra plantilla, o "Sin nada".`}
              </p>
            )}
            {(t.template === "banda" || t.template === "etiqueta") && (
              <input
                value={t.overlay}
                maxLength={60}
                disabled={!!resuelto[p.id]}
                onChange={(e) => set({ overlay: e.target.value })}
                placeholder="Frase corta (2 a 6 palabras)"
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/40"
              />
            )}
            {p.platform === "instagram" && p.postType === "feed" && !g.isVideo ? (
              <p className="pt-1 text-xs text-muted-foreground">
                Música: los posts de foto no la admiten (Meta no lo permite por la API). La versión con música es el Reel, que también sale en el feed.
              </p>
            ) : (
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Música</label>
                {g.music.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Esta marca todavía no tiene biblioteca de música.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {[
                      {
                        key: null as string | null,
                        name: g.isVideo ? "Sonido original" : p.postType === "reel" ? "Sin música" : "Sin música (sale como foto)",
                        url: null as string | null,
                      },
                      ...g.music,
                    ].map((m) => (
                      <label key={m.key ?? "none"} className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs", t.music === m.key && "border-primary bg-primary/5")}>
                        <input type="radio" name={`music-${p.id}`} checked={t.music === m.key} disabled={!!resuelto[p.id]} onChange={() => set({ music: m.key })} />
                        <span className="flex-1 truncate font-medium capitalize">{m.name}</span>
                        {m.url && <audio src={m.url} controls preload="none" className="h-7 w-40" />}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!p.renderUrl && !editado && <p className="text-xs text-muted-foreground">Preparando la pieza final…</p>}
            {editado && !resuelto[p.id] && (
              <Button size="sm" variant="outline" disabled={pending} onClick={verComoQueda}>
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Ver cómo queda
              </Button>
            )}
          </div>

          {/* Texto editable */}
          {p.postType === "story" ? (
            <p className="text-sm text-muted-foreground">Las historias no llevan texto de publicación: solo la imagen en 9:16 (con la frase de arriba, si elegiste plantilla).</p>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Texto</label>
              <textarea
                value={t.caption}
                disabled={!!resuelto[p.id]}
                onChange={(e) => set({ caption: e.target.value })}
                rows={6}
                className="w-full resize-y rounded-xl border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-primary/40"
              />
              <input
                value={t.hashtags}
                disabled={!!resuelto[p.id]}
                onChange={(e) => set({ hashtags: e.target.value })}
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm text-muted-foreground outline-none focus:ring-2 focus:ring-primary/40"
              />
              <p className="text-right text-xs text-muted-foreground">
                {editado ? "Cambios sin guardar: se guardan al aprobar o con «Ver cómo queda» · " : ""}
                {t.caption.length + t.hashtags.length + 2} / 2200
              </p>
            </div>
          )}

          {/* Cuándo */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Cuándo</span>
            <button
              type="button"
              onClick={() => setCuando("ya")}
              className={cn("rounded-full border px-3 py-1 text-xs font-semibold", cuando === "ya" && "border-primary bg-primary/10 text-primary")}
            >
              Apenas apruebe
            </button>
            <button
              type="button"
              onClick={() => setCuando("programar")}
              className={cn("rounded-full border px-3 py-1 text-xs font-semibold", cuando === "programar" && "border-primary bg-primary/10 text-primary")}
            >
              Programar
            </button>
            {p.suggestions.length > 0 && !resuelto[p.id] && (
              <div className="flex w-full flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">Mejores horarios según tus métricas:</span>
                {p.suggestions.map((sg) => (
                  <button
                    key={sg.at}
                    type="button"
                    title={`Confianza ${sg.confianza}`}
                    onClick={() => {
                      setCuando("programar")
                      setFecha(toLocalInput(new Date(sg.at)))
                    }}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize",
                      cuando === "programar" && fecha === toLocalInput(new Date(sg.at)) ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                    )}
                  >
                    {sg.label} <span className={sg.up ? "text-emerald-600" : "text-muted-foreground"}>{sg.lift}</span>
                    {sg.confianza === "baja" && <span className="ml-1 font-normal normal-case text-amber-600">· poca data</span>}
                  </button>
                ))}
              </div>
            )}
            {cuando === "programar" && (
              <input
                type="datetime-local"
                value={fecha}
                min={toLocalInput(new Date())}
                onChange={(e) => setFecha(e.target.value)}
                className="rounded-lg border bg-background px-2 py-1 text-xs"
              />
            )}
          </div>

          {/* Rehacer con IA: texto y frase nuevos para todos los formatos pendientes de esta subida */}
          <div className="rounded-xl border border-dashed p-3">
            {!rehacer.open ? (
              <button
                type="button"
                onClick={() => setRehacer((r) => ({ ...r, open: true }))}
                disabled={pending || rehacer.trabajando}
                className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline disabled:opacity-60"
              >
                {rehacer.trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {rehacer.trabajando ? "La IA lo está rehaciendo… (unos segundos)" : "Rehacer con IA"}
              </button>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={rehacer.pedido}
                  onChange={(e) => setRehacer((r) => ({ ...r, pedido: e.target.value }))}
                  rows={2}
                  placeholder="¿Qué querés distinto? (opcional) Ej: más gracioso, mencioná el combo, menos emojis"
                  className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                />
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={rehacer.diseno} onChange={(e) => setRehacer((r) => ({ ...r, diseno: e.target.checked }))} />
                    Otro diseño
                  </label>
                  {g.music.length > 1 && (
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={rehacer.musica} onChange={(e) => setRehacer((r) => ({ ...r, musica: e.target.checked }))} />
                      Otra música
                    </label>
                  )}
                  <span className="text-muted-foreground">Se rehacen los {pendientes.length} formatos pendientes.</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        setRehacer((r) => ({ ...r, open: false, trabajando: true }))
                        await rehacerConIA(pendientes.map((x) => x.id), rehacer.pedido, rehacer.diseno, rehacer.musica)
                        // La IA escribe (~10 s) y el worker arma las piezas nuevas: se refresca solo.
                        for (const ms of [8000, 6000, 8000, 10000]) {
                          await new Promise((r) => setTimeout(r, ms))
                          router.refresh()
                        }
                        setRehacer((r) => ({ ...r, trabajando: false }))
                      })
                    }
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Rehacer
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRehacer((r) => ({ ...r, open: false }))}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>

          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          {/* Acciones */}
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
            {!resuelto[p.id] && (
              <>
                <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" disabled={pending} onClick={() => run(() => aprobar([p.id]))}>
                  {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                  Aprobar {label(p).toLowerCase()}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-red-600 hover:bg-red-50"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      await rechazarPost(p.id, "Rechazado desde Aprobaciones")
                      setResuelto((r) => ({ ...r, [p.id]: "rechazado" }))
                    })
                  }
                >
                  <XCircle className="h-3.5 w-3.5" /> Rechazar
                </Button>
              </>
            )}
            {pendientes.length > 1 && (
              <Button size="sm" variant="secondary" className="ml-auto gap-1" disabled={pending} onClick={() => run(() => aprobar(pendientes.map((x) => x.id)))}>
                <CheckCheck className="h-3.5 w-3.5" /> Aprobar las {pendientes.length}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

/**
 * Aviso de lo que la IA todavía está armando. Mientras haya algo, la página se actualiza sola
 * cada 15 s: cada subida aparece recién cuando sus piezas finales están listas.
 */
export function Preparando({ cantidad }: { cantidad: number }) {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 15_000)
    return () => clearInterval(t)
  }, [router])
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <Loader2 className="h-4 w-4 animate-spin" />
      {cantidad === 1 ? "1 subida se está preparando" : `${cantidad} subidas se están preparando`}: la IA arma y revisa las piezas finales. Aparecen acá solas en uno o dos minutos.
    </div>
  )
}

export function ListaAprobaciones({ grupos }: { grupos: Grupo[] }) {
  if (grupos.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed text-center">
        <CheckCircle className="h-10 w-10 text-emerald-500/40" />
        <div>
          <p className="font-medium text-muted-foreground">Todo al día</p>
          <p className="mt-1 text-sm text-muted-foreground">No hay publicaciones esperando tu OK.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-6">
      {grupos.map((g) => (
        // La clave incluye el contenido: si la IA lo rehace, la tarjeta toma los textos nuevos.
        <GrupoCard key={g.key + g.posts.map((p) => p.caption + p.overlayText + p.template + p.musicKey + p.renderUrl?.split("?")[0]).join("|")} g={g} />
      ))}
    </div>
  )
}

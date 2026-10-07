"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Bell, BellOff, Check, HelpCircle, Loader2, Volume2, X } from "lucide-react"
import { PlatformIcon } from "@/components/ui/platform-icon"
import { aprobarPost, rechazarPost, volverAAprobacion } from "@/lib/cos/actions"
import { elegirMarca } from "@/lib/cos/brand-actions"
import { explicarError } from "@/lib/ui-errors"
import { MOTIVOS, validarRechazo } from "../../../shared/cos/rechazos"
import { claveVapid } from "@/lib/push-vapid"
import { cn } from "@/lib/utils"

/**
 * F12 · App de aprobación en el celular: una pieza por tarjeta (aunque dos salgan de la misma
 * foto, van por separado), deslizar a la derecha aprueba y a la izquierda rechaza — como Tinder.
 * Siempre con sonido: iOS exige un toque antes de dejar sonar nada ("Empezar").
 */
export type Tarjeta = {
  id: string
  grupoKey: string
  platform: "instagram" | "facebook"
  postType: "feed" | "carousel" | "reel" | "story"
  caption: string
  hashtags: string
  overlayText: string
  accountName: string
  brand: { name: string; color: string } | null
  renderUrl: string | null
  mediaUrl: string | null
  mediaEsVideo: boolean
  qa: { ok?: boolean; tapa?: string; legible?: boolean; skipped?: string } | null
  motor: { at: string; porque: string; prueba: boolean; fijo: boolean } | null
  musicaPorque: string | null
  reel: { idea: string; segundos: number; respaldo: boolean } | null
  riskFlags: string[]
  description: string | null
  submittedBy: string | null
  scheduledAt: string | null
}

const TIPO_LABEL: Record<Tarjeta["postType"], string> = { feed: "Post", reel: "Reel", story: "Historia", carousel: "Carrusel" }
const FLAG_TEXT: Record<string, string> = {
  imagen_generada_o_de_banco: "Parece generada o de banco",
  caras_de_clientes: "Aparecen caras que no son del equipo",
  menores: "Aparecen menores",
  marca_ajena: "Se ven logos de otras marcas",
  higiene: "Algo fuera de norma de higiene",
  baja_calidad: "Calidad baja",
}
const UMBRAL = 110 // px para decidir el swipe
const TRES_HORAS_MS = 3 * 3600_000

function esVideo(t: Tarjeta): boolean {
  if (t.renderUrl) return /\.mp4(\?|$)/.test(t.renderUrl)
  return t.mediaEsVideo
}
function srcDe(t: Tarjeta): string | null {
  return t.renderUrl ?? t.mediaUrl
}

type Toast = { msg: string; tono: "ok" | "error" | "info"; deshacer?: () => void }

export function AppAprobar(props: {
  tarjetas: Tarjeta[]
  pendientes: number
  preparando: number
  marcaActual: string
  marcas: { slug: string; name: string; color: string }[]
  vapidKey: string | null
}) {
  const router = useRouter()
  const [pendienteMarca, startMarca] = useTransition()
  const [started, setStarted] = useState(false)
  const [cola, setCola] = useState(props.tarjetas)
  const totalInicial = props.tarjetas.length
  const actual = cola[0] ?? null

  // Posición de arrastre de la tarjeta de arriba (gesto tipo Tinder).
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [volando, setVolando] = useState<"left" | "right" | "down" | null>(null)
  const [busy, setBusy] = useState(false)
  const startRef = useRef({ x: 0, y: 0 })

  const [sheet, setSheet] = useState<null | "rechazar" | "elegirHora">(null)
  const [motivos, setMotivos] = useState<string[]>([])
  const [nota, setNota] = useState("")
  const [tambienResto, setTambienResto] = useState(false)
  const [fechaElegida, setFechaElegida] = useState("")

  const [toast, setToast] = useState<Toast | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [pushEstado, setPushEstado] = useState<"inactivo" | "activando" | "activo" | "denegado" | "no-disponible">("inactivo")

  const videoRef = useRef<HTMLVideoElement>(null)

  // `cola` es local (para poder sacar tarjetas sin esperar al servidor); hay que resincronizarla
  // cuando el servidor manda datos nuevos de verdad (cambio de marca, o la fijada de abajo cuando
  // terminan de armarse piezas) — si no, cambiar de marca no movía nada de lo que se veía.
  useEffect(() => {
    setCola(props.tarjetas)
    setPos({ x: 0, y: 0 })
    setDragging(false)
    setVolando(null)
    setSheet(null)
    setMotivos([])
    setNota("")
    setTambienResto(false)
    setFechaElegida("")
  }, [props.tarjetas])

  // La app se queda vacía: si hay piezas armándose, se fija sola cada 20 s (igual que la web).
  useEffect(() => {
    if (cola.length > 0 || props.preparando <= 0) return
    const t = setInterval(() => router.refresh(), 20_000)
    return () => clearInterval(t)
  }, [cola.length, props.preparando, router])

  // Service worker listo desde el arranque (solo registra el script; pedir permiso es aparte).
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js").catch(() => {})
    if (!props.vapidKey || !("PushManager" in window)) return
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setPushEstado(sub ? "activo" : "inactivo"))
      .catch(() => {})
  }, [props.vapidKey])

  // El video de la tarjeta de arriba suena solo (después de "Empezar", cada swipe es el gesto que
  // habilita el siguiente: iOS deja seguir reproduciendo sin volver a pedir permiso).
  useEffect(() => {
    if (!started || !actual || !esVideo(actual)) return
    const v = videoRef.current
    if (!v) return
    v.currentTime = 0
    v.muted = false
    v.play().catch(() => {
      // Si el navegador lo bloquea, el video queda pausado con su primer cuadro: no es un error fatal.
    })
  }, [started, actual?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const mostrarToast = useCallback((msg: string, tono: Toast["tono"] = "info", deshacer?: () => void) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ msg, tono, deshacer })
    toastTimer.current = setTimeout(() => setToast(null), deshacer ? 5000 : 3000)
  }, [])

  const resetDrag = () => {
    setPos({ x: 0, y: 0 })
    setDragging(false)
  }

  function quitarDeCola(id: string) {
    setCola((c) => c.filter((t) => t.id !== id))
    resetDrag()
    setSheet(null)
    setMotivos([])
    setNota("")
    setTambienResto(false)
    setFechaElegida("")
  }

  function volarYQuitar(dir: "left" | "right", id: string) {
    setVolando(dir)
    setTimeout(() => {
      quitarDeCola(id)
      setVolando(null)
    }, 180)
  }

  /**
   * "No sé": ni aprueba ni rechaza — manda la tarjeta al final de la cola para decidirla después,
   * sin tocar el servidor (sigue esperando aprobación como estaba). Pedido de Javier (07-10).
   */
  function omitir() {
    if (busy || sheet || volando) return
    setVolando("down")
    setTimeout(() => {
      setCola((c) => (c.length > 1 ? [...c.slice(1), c[0]] : c))
      resetDrag()
      setVolando(null)
    }, 180)
  }

  /** Cerrar una hoja (motivo de rechazo / elegir hora) sin decidir nada: la tarjeta vuelve al centro. */
  function cerrarSheet() {
    setSheet(null)
    resetDrag()
  }

  // ── Aprobar ───────────────────────────────────────────────────────────────
  async function confirmarAprobar(t: Tarjeta, cuando: string | null | "motor") {
    if (busy) return
    if (!navigator.onLine) {
      mostrarToast("Sin conexión: esperá un poco y volvé a intentar", "error")
      resetDrag()
      return
    }
    setBusy(true)
    try {
      const vistoAt = cuando === "motor" ? t.motor?.at : undefined
      await aprobarPost(t.id, cuando, vistoAt)
      const horaFinal = cuando === "motor" ? t.motor?.at : cuando
      const puedeDeshacer = !!horaFinal && Date.parse(horaFinal) - Date.now() > TRES_HORAS_MS
      volarYQuitar("right", t.id)
      mostrarToast(
        "Aprobado ✓",
        "ok",
        puedeDeshacer
          ? () => {
              volverAAprobacion(t.id)
                .then(() => {
                  setCola((c) => [t, ...c])
                  mostrarToast("Deshecho: vuelve a la cola", "info")
                })
                .catch((e) => mostrarToast(explicarError(e), "error"))
            }
          : undefined,
      )
    } catch (e) {
      mostrarToast(explicarError(e), "error")
      resetDrag()
    } finally {
      setBusy(false)
    }
  }

  function pedirAprobar(t: Tarjeta) {
    if (t.motor) {
      void confirmarAprobar(t, "motor")
    } else {
      setSheet("elegirHora")
    }
  }

  // ── Rechazar ──────────────────────────────────────────────────────────────
  async function confirmarRechazar(t: Tarjeta) {
    if (busy) return
    const problema = validarRechazo(motivos, nota)
    if (problema) {
      mostrarToast(problema, "error")
      return
    }
    if (!navigator.onLine) {
      mostrarToast("Sin conexión: esperá un poco y volvé a intentar", "error")
      return
    }
    setBusy(true)
    try {
      await rechazarPost(t.id, motivos, nota, tambienResto)
      volarYQuitar("left", t.id)
      mostrarToast(tambienResto ? "Rechazada toda la subida" : "Rechazada", "ok")
    } catch (e) {
      mostrarToast(explicarError(e), "error")
    } finally {
      setBusy(false)
    }
  }

  // ── Gesto (pointer events) ───────────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent) {
    if (busy || sheet || volando) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    startRef.current = { x: e.clientX, y: e.clientY }
    setDragging(true)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return
    setPos({ x: e.clientX - startRef.current.x, y: (e.clientY - startRef.current.y) * 0.4 })
  }
  function onPointerUp() {
    if (!dragging || !actual) return
    setDragging(false)
    if (pos.x > UMBRAL) pedirAprobar(actual)
    else if (pos.x < -UMBRAL) setSheet("rechazar")
    else setPos({ x: 0, y: 0 })
  }

  function cambiarMarca(slug: string) {
    startMarca(async () => {
      await elegirMarca(slug)
      router.refresh()
    })
  }

  async function activarPush() {
    if (!props.vapidKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushEstado("no-disponible")
      return
    }
    setPushEstado("activando")
    try {
      const reg = await navigator.serviceWorker.register("/sw.js")
      const permiso = await Notification.requestPermission()
      if (permiso !== "granted") {
        setPushEstado("denegado")
        return
      }
      let sub = await reg.pushManager.getSubscription()
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveVapid(props.vapidKey) })
      const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) })
      if (!r.ok) throw new Error("no se pudo guardar")
      setPushEstado("activo")
      mostrarToast("Avisos activados: te aviso cuando haya piezas nuevas", "ok")
    } catch {
      setPushEstado("no-disponible")
      mostrarToast("No se pudieron activar los avisos en este navegador", "error")
    }
  }

  const rotacion = pos.x / 18
  const estiloTarjeta = useMemo(() => {
    if (volando === "down") return { transform: "translate(0px, 500px) rotate(0deg) scale(0.9)", transition: "transform 180ms ease-in", opacity: 0.3 }
    if (volando) return { transform: `translate(${volando === "right" ? 650 : -650}px, ${pos.y}px) rotate(${volando === "right" ? 25 : -25}deg)`, transition: "transform 180ms ease-in", opacity: 0.4 }
    if (dragging) return { transform: `translate(${pos.x}px, ${pos.y}px) rotate(${rotacion}deg)`, transition: "none" }
    if (sheet) return { transform: `translate(${pos.x || (sheet === "rechazar" ? -160 : 0)}px, 0px) rotate(${pos.x ? rotacion : sheet === "rechazar" ? -8 : 0}deg)`, transition: "transform 200ms ease-out" }
    return { transform: "translate(0px, 0px) rotate(0deg)", transition: "transform 220ms ease-out" }
  }, [pos, dragging, volando, sheet, rotacion])

  if (!started) return <PantallaEmpezar onEmpezar={() => setStarted(true)} />

  return (
    <div className="flex h-full w-full flex-col" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* Barra de arriba: los chips de marca se deslizan en su propia franja; el contador y la
          campana de avisos quedan siempre a la vista (si no, con marcas largas se iban de pantalla). */}
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-2">
        <div className={cn("flex min-w-0 flex-1 items-center gap-2 overflow-x-auto", pendienteMarca && "opacity-50")}>
          <button
            type="button"
            disabled={pendienteMarca}
            onClick={() => cambiarMarca("")}
            className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-semibold", !props.marcaActual ? "border-white bg-white text-black" : "border-white/30 text-white/70")}
          >
            Todas
          </button>
          {props.marcas.map((m) => (
            <button
              key={m.slug}
              type="button"
              disabled={pendienteMarca}
              onClick={() => cambiarMarca(m.slug)}
              className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-semibold", props.marcaActual === m.slug ? "border-white bg-white text-black" : "border-white/30 text-white/70")}
            >
              {m.name}
            </button>
          ))}
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold tabular-nums text-white/70">
          {pendienteMarca && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {cola.length > 0 ? `${totalInicial - cola.length + 1} / ${totalInicial}` : `${totalInicial} / ${totalInicial}`}
        </span>
        <button
          type="button"
          onClick={pushEstado === "activo" ? undefined : activarPush}
          aria-label={pushEstado === "activo" ? "Avisos activados" : "Activar avisos"}
          title={pushEstado === "activo" ? "Te avisamos cuando haya piezas nuevas" : "Avisarme cuando haya piezas nuevas"}
          className="shrink-0 rounded-full p-1.5 text-white/70"
        >
          {pushEstado === "activando" ? <Loader2 className="h-4 w-4 animate-spin" /> : pushEstado === "activo" ? <Bell className="h-4 w-4 text-emerald-400" /> : <BellOff className="h-4 w-4" />}
        </button>
      </header>

      {/* Pila de tarjetas */}
      <div className="relative min-h-0 flex-1 px-3 pb-3">
        {!actual ? (
          <EstadoVacio preparando={props.preparando} />
        ) : (
          <>
            {/* Fantasmas detrás, solo para dar la sensación de pila */}
            {cola[2] && <div className="absolute inset-3 rounded-3xl bg-white/5" style={{ transform: "translateY(16px) scale(0.94)" }} />}
            {cola[1] && <div className="absolute inset-3 rounded-3xl bg-white/10" style={{ transform: "translateY(8px) scale(0.97)" }} />}

            <div
              className="absolute inset-3 flex touch-none select-none flex-col overflow-hidden rounded-3xl bg-neutral-900 shadow-2xl"
              style={estiloTarjeta}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {/* Post y carrusel son fotos 4:5 con el diseño (título, marca) ya pintado adentro;
                  si la tarjeta es más alta que la foto (letterbox), la info de acá abajo no se
                  superpone — va DEBAJO, no encima (si no, tapaba el título de la pieza). Reel e
                  historia son video/foto 9:16 que llenan la tarjeta entera: ahí sí va de overlay,
                  como las historias de Instagram. */}
              {actual.postType === "feed" || actual.postType === "carousel" ? (
                <>
                  <div className="relative min-h-0 flex-1 bg-black">
                    <TarjetaMedia t={actual} videoRef={videoRef} />
                    {pos.x > 24 && <Sello texto="APROBAR" color="border-emerald-400 text-emerald-400" style={{ opacity: Math.min(1, pos.x / UMBRAL), left: 20 }} />}
                    {pos.x < -24 && <Sello texto="RECHAZAR" color="border-red-400 text-red-400" style={{ opacity: Math.min(1, -pos.x / UMBRAL), right: 20 }} />}
                  </div>
                  <InfoTarjeta t={actual} variante="debajo" />
                </>
              ) : (
                <>
                  <TarjetaMedia t={actual} videoRef={videoRef} />
                  {pos.x > 24 && <Sello texto="APROBAR" color="border-emerald-400 text-emerald-400" style={{ opacity: Math.min(1, pos.x / UMBRAL), left: 20 }} />}
                  {pos.x < -24 && <Sello texto="RECHAZAR" color="border-red-400 text-red-400" style={{ opacity: Math.min(1, -pos.x / UMBRAL), right: 20 }} />}
                  <InfoTarjeta t={actual} variante="overlay" />
                </>
              )}

              {busy && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Botones (además del gesto, para quien prefiera tocar) */}
      {actual && !sheet && (
        <div className="flex shrink-0 items-center justify-center gap-6 pb-4 pt-1">
          <button type="button" disabled={busy} aria-label="Rechazar" onClick={() => setSheet("rechazar")} className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-red-400 text-red-400 disabled:opacity-40">
            <X className="h-8 w-8" />
          </button>
          <button type="button" disabled={busy || cola.length <= 1} aria-label="No sé: la dejo para después" title="La dejo para después, sin decidir" onClick={omitir} className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-white/30 text-white/50 disabled:opacity-30">
            <HelpCircle className="h-5 w-5" />
          </button>
          <button type="button" disabled={busy} aria-label="Aprobar" onClick={() => pedirAprobar(actual)} className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-emerald-400 text-emerald-400 disabled:opacity-40">
            <Check className="h-8 w-8" />
          </button>
        </div>
      )}

      {/* Hoja: elegir cuándo aprobar (sin horario de agenda) */}
      {sheet === "elegirHora" && actual && (
        <Hoja onCerrar={cerrarSheet}>
          <p className="mb-3 text-sm text-white/70">Esta pieza no tiene un horario propuesto por la agenda.</p>
          <div className="flex flex-col gap-2">
            <button type="button" disabled={busy} onClick={() => confirmarAprobar(actual, null)} className="rounded-xl bg-emerald-500 py-3 font-semibold text-black disabled:opacity-50">
              Publicar ya
            </button>
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={fechaElegida}
                onChange={(e) => setFechaElegida(e.target.value)}
                className="flex-1 rounded-xl border border-white/20 bg-transparent px-3 py-2.5 text-white"
              />
              <button
                type="button"
                disabled={busy || !fechaElegida}
                onClick={() => confirmarAprobar(actual, new Date(fechaElegida).toISOString())}
                className="rounded-xl border border-white/30 px-4 py-2.5 font-semibold disabled:opacity-40"
              >
                Confirmar
              </button>
            </div>
          </div>
        </Hoja>
      )}

      {/* Hoja: motivo de rechazo */}
      {sheet === "rechazar" && actual && (
        <Hoja onCerrar={cerrarSheet}>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {MOTIVOS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMotivos((ms) => (ms.includes(m.id) ? ms.filter((x) => x !== m.id) : [...ms, m.id]))}
                className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", motivos.includes(m.id) ? "border-red-400 bg-red-400/20 text-red-300" : "border-white/25 text-white/80")}
              >
                {m.label}
              </button>
            ))}
          </div>
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={500}
            placeholder="Contá por qué (opcional si elegiste un motivo)"
            rows={2}
            className="mb-2 w-full rounded-xl border border-white/20 bg-transparent px-3 py-2 text-sm text-white placeholder:text-white/40"
          />
          <label className="mb-3 flex items-center gap-2 text-sm text-white/70">
            <input type="checkbox" checked={tambienResto} onChange={(e) => setTambienResto(e.target.checked)} /> Rechazar también el resto de esta subida
          </label>
          <button type="button" disabled={busy} onClick={() => confirmarRechazar(actual)} className="w-full rounded-xl bg-red-500 py-3 font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "Rechazar"}
          </button>
        </Hoja>
      )}

      {toast && (
        <div className={cn("pointer-events-auto fixed left-1/2 top-[calc(env(safe-area-inset-top)+8px)] z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg", toast.tono === "ok" ? "bg-emerald-500 text-black" : toast.tono === "error" ? "bg-red-500 text-white" : "bg-white text-black")}>
          {toast.msg}
          {toast.deshacer && (
            <button type="button" onClick={toast.deshacer} className="ml-3 underline">
              Deshacer
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Sello({ texto, color, style }: { texto: string; color: string; style: React.CSSProperties }) {
  return (
    <div className={cn("pointer-events-none absolute top-8 rounded-lg border-4 px-3 py-1 text-2xl font-extrabold tracking-wider", color)} style={{ ...style, transform: "rotate(-12deg)" }}>
      {texto}
    </div>
  )
}

function TarjetaMedia({ t, videoRef }: { t: Tarjeta; videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const src = srcDe(t)
  if (!src) return <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40">Sin archivo</div>
  if (esVideo(t)) {
    return <video ref={videoRef} src={src} className="absolute inset-0 h-full w-full object-contain" playsInline loop controls={false} />
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
  )
}

/**
 * "overlay" (reel/historia, video o foto 9:16 que llena la tarjeta): franja con degradé ENCIMA,
 * como las historias de Instagram. "debajo" (post/carrusel, foto 4:5 con el diseño ya adentro):
 * panel sólido DEBAJO de la foto, en el espacio que deja el letterbox — nunca tapa el diseño.
 */
function InfoTarjeta({ t, variante }: { t: Tarjeta; variante: "overlay" | "debajo" }) {
  const textoBase = t.caption.trim() || t.overlayText.trim()
  const [abierto, setAbierto] = useState(false)
  return (
    <div
      className={cn(
        "px-4 pb-4",
        variante === "overlay"
          ? "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent pt-10"
          : "shrink-0 border-t border-white/10 bg-neutral-900 pt-3",
      )}
    >
      <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
        <span className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5">
          <PlatformIcon platform={t.platform} className="h-3 w-3" /> {TIPO_LABEL[t.postType]}
        </span>
        <span className="text-white/60">{t.accountName}</span>
        {t.brand && (
          <span className="flex items-center gap-1 text-white/60">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.brand.color }} /> {t.brand.name}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {t.motor ? (
          <span className="rounded-full bg-sky-500/25 px-2 py-0.5 text-[11px] font-medium text-sky-200">{t.motor.porque}</span>
        ) : (
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-white/70">Sin horario de agenda</span>
        )}
        {t.qa && t.qa.ok === false && (
          <span className="flex items-center gap-1 rounded-full bg-amber-500/25 px-2 py-0.5 text-[11px] font-medium text-amber-200">
            <AlertTriangle className="h-3 w-3" /> {t.qa.tapa ? `tapa ${t.qa.tapa}` : "no se lee bien"}
          </span>
        )}
        {t.riskFlags.map((f) => (
          <span key={f} className="flex items-center gap-1 rounded-full bg-amber-500/25 px-2 py-0.5 text-[11px] font-medium text-amber-200">
            <AlertTriangle className="h-3 w-3" /> {FLAG_TEXT[f] ?? f}
          </span>
        ))}
        {t.reel?.respaldo && <span className="rounded-full bg-amber-500/25 px-2 py-0.5 text-[11px] font-medium text-amber-200">guion automático</span>}
      </div>
      {textoBase && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setAbierto((v) => !v)
          }}
          className={cn("pointer-events-auto mt-2 w-full text-left text-sm text-white", !abierto && "line-clamp-2")}
        >
          {textoBase}
        </button>
      )}
    </div>
  )
}

function EstadoVacio({ preparando }: { preparando: number }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-white/70">
      <p className="text-5xl">🎉</p>
      <p className="text-lg font-semibold text-white">Nada por aprobar</p>
      {preparando > 0 && <p className="max-w-xs text-sm">{preparando} pieza{preparando > 1 ? "s" : ""} se está{preparando > 1 ? "n" : ""} armando: aparece{preparando > 1 ? "n" : ""} acá sola{preparando > 1 ? "s" : ""}.</p>}
    </div>
  )
}

function PantallaEmpezar({ onEmpezar }: { onEmpezar: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center text-white">
      <Volume2 className="h-10 w-10 text-white/60" />
      <div className="space-y-1.5">
        <p className="text-xl font-semibold">Aprobar</p>
        <p className="text-sm text-white/60">Cada pieza suena con su audio. El celular necesita un toque para activarlo.</p>
      </div>
      <button type="button" onClick={onEmpezar} className="rounded-full bg-white px-8 py-3 text-base font-semibold text-black">
        Empezar
      </button>
    </div>
  )
}

function Hoja({ children, onCerrar }: { children: React.ReactNode; onCerrar: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={onCerrar} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="w-full rounded-t-3xl bg-neutral-900 p-4 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
        {children}
        <button type="button" onClick={onCerrar} className="mt-3 w-full py-1 text-center text-sm text-white/50">
          Cancelar
        </button>
      </div>
    </div>
  )
}

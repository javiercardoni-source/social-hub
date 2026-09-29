"use client"

import { explicarError } from "@/lib/ui-errors"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { armarBrandbook, aprobarBrandbook, guardarBrandbook, reabrirModulo, turnoEntrevista } from "@/lib/cos/branding-actions"
import { BookOpen, CheckCircle, Circle, CircleDot, ClipboardList, Loader2, Send, Sparkles, Wand2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { DatosVigentes } from "../../../../shared/cos/datos-vigentes"
import { DatosVigentesForm } from "./datos-vigentes"
import { Motores, type Insumo, type Tema } from "./motores"

export type ModuloEstado = {
  id: string
  label: string
  goal: string
  status: "pending" | "in_progress" | "done"
  messages: { role: "assistant" | "user"; content: string; at: string }[]
  summary: string | null
}

type Props = {
  brandName: string
  color: string
  modulos: ModuloEstado[]
  brandbook: string | null
  brandbookStatus: "none" | "draft" | "approved"
  datos: DatosVigentes
  datosAt: string | null
  insumos: Insumo[]
  musica: Tema[]
}

export function MarcaClient({ brandName, color, modulos, brandbook, brandbookStatus, datos, datosAt, insumos, musica }: Props) {
  const router = useRouter()
  const firstOpen = modulos.find((m) => m.status === "in_progress") ?? modulos.find((m) => m.status === "pending") ?? modulos[0]
  const [activo, setActivo] = useState<string>(firstOpen.id)
  const [vista, setVista] = useState<"chat" | "brandbook" | "datos" | "motores">("chat")
  const [texto, setTextoState] = useState("")
  // Borrador en el navegador: si falla el envío o se cierra la pestaña, la respuesta no se pierde.
  const draftKey = `cos-marca-borrador:${brandName}:${activo}`
  const setTexto = (v: string) => {
    setTextoState(v)
    try {
      if (v) localStorage.setItem(draftKey, v)
      else localStorage.removeItem(draftKey)
    } catch {}
  }
  const [draftFor, setDraftFor] = useState<string | null>(null)
  if (draftFor !== draftKey) {
    setDraftFor(draftKey)
    let saved = ""
    try {
      saved = localStorage.getItem(draftKey) ?? ""
    } catch {}
    setTextoState(saved)
  }
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [bb, setBb] = useState(brandbook ?? "")
  const fin = useRef<HTMLDivElement>(null)

  const m = modulos.find((x) => x.id === activo)!
  const cerrados = modulos.filter((x) => x.status === "done").length
  const listosMotores =
    [insumos.some((i) => i.kind === "referencia" && i.status === "lista"), ...(["fuente_titulo", "fuente_texto", "logo"] as const).map((k) => insumos.some((i) => i.kind === k))].filter(Boolean).length +
    (musica.length ? 1 : 0)

  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [m.messages.length, pending])

  // Si se rearma el brandbook, el editor toma la versión nueva (se ajusta en el render, sin efecto).
  const [bbBase, setBbBase] = useState(brandbook)
  if (brandbook !== bbBase) {
    setBbBase(brandbook)
    setBb(brandbook ?? "")
  }

  function run(fn: () => Promise<unknown>, onOk?: () => void) {
    setError(null)
    start(async () => {
      try {
        await fn()
        onOk?.()
        router.refresh()
      } catch (e) {
        setError(explicarError(e))
      }
    })
  }

  function enviar() {
    const t = texto.trim()
    if (!t) return
    // El texto se borra recién cuando quedó guardado.
    run(() => turnoEntrevista(m.id, t), () => setTexto(""))
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* Módulos */}
      <div className="min-w-0 space-y-3">
        <Card className="p-3">
          <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Entrevista · {cerrados}/{modulos.length}
          </p>
          <div className="flex gap-1 overflow-x-auto lg:flex-col">
            {modulos.map((x, i) => (
              <button
                key={x.id}
                type="button"
                onClick={() => {
                  setActivo(x.id)
                  setVista("chat")
                }}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm",
                  vista === "chat" && x.id === activo ? "bg-primary/10 font-bold text-primary" : "hover:bg-muted",
                )}
              >
                {x.status === "done" ? (
                  <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />
                ) : x.status === "in_progress" ? (
                  <CircleDot className="h-4 w-4 shrink-0 text-amber-500" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                )}
                <span className="whitespace-nowrap">
                  {i + 1}. {x.label}
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-3">
          <button
            type="button"
            onClick={() => setVista("brandbook")}
            className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm", vista === "brandbook" ? "bg-primary/10 font-bold text-primary" : "hover:bg-muted")}
          >
            <BookOpen className="h-4 w-4" />
            <span className="flex-1">Brandbook</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-bold",
                brandbookStatus === "approved" ? "bg-emerald-100 text-emerald-700" : brandbookStatus === "draft" ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground",
              )}
            >
              {brandbookStatus === "approved" ? "Aprobado" : brandbookStatus === "draft" ? "Borrador" : "Sin armar"}
            </span>
          </button>
          <p className="mt-2 px-1 text-[11px] leading-snug text-muted-foreground">
            Al aprobarlo, la IA escribe los textos y las frases sobre las imágenes siguiendo el brandbook.
          </p>
          <button
            type="button"
            onClick={() => setVista("datos")}
            className={cn("mt-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm", vista === "datos" ? "bg-primary/10 font-bold text-primary" : "hover:bg-muted")}
          >
            <ClipboardList className="h-4 w-4" />
            <span className="flex-1">Datos vigentes</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", datosAt ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>
              {datosAt ? "Cargados" : "Vacío"}
            </span>
          </button>
          <p className="mt-2 px-1 text-[11px] leading-snug text-muted-foreground">Precios, combos, promos, horarios y links de hoy.</p>
          <button
            type="button"
            onClick={() => setVista("motores")}
            className={cn("mt-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm", vista === "motores" ? "bg-primary/10 font-bold text-primary" : "hover:bg-muted")}
          >
            <Wand2 className="h-4 w-4" />
            <span className="flex-1">Motores visuales</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", listosMotores === 5 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
              {listosMotores}/5
            </span>
          </button>
          <p className="mt-2 px-1 text-[11px] leading-snug text-muted-foreground">Referencias de estilo, tipografías, logo y sonido.</p>
        </Card>
      </div>

      {vista === "motores" ? (
        <Motores brandName={brandName} insumos={insumos} musica={musica} />
      ) : vista === "datos" ? (
        <DatosVigentesForm brandName={brandName} datos={datos} actualizado={datosAt} />
      ) : vista === "chat" ? (
        <Card className="flex min-h-[70vh] flex-col overflow-hidden">
          <div className="border-b px-4 py-3">
            <p className="flex items-center gap-2 font-bold">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
              {m.label}
            </p>
            <p className="text-xs text-muted-foreground">{m.goal}</p>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {m.messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
                <Sparkles className="h-8 w-8 text-primary/50" />
                <p className="max-w-sm text-sm text-muted-foreground">
                  El Branding Manager te va a hacer preguntas de a una sobre {m.label.toLowerCase()} de {brandName}. Respondé como
                  hablás: con ejemplos y detalles. Lo que ya sabemos te lo muestra para confirmar.
                </p>
                <Button disabled={pending} onClick={() => run(() => turnoEntrevista(m.id, null))}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Empezar
                </Button>
              </div>
            )}
            {m.messages.filter((msg) => msg.content?.trim()).map((msg, i) => (
              <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    msg.role === "user" ? "bg-primary text-white" : "bg-muted",
                  )}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {!pending && m.status !== "done" && m.messages.filter((msg) => msg.content?.trim()).at(-1)?.role === "user" && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Tu última respuesta quedó guardada pero el Branding Manager no llegó a contestar.
                <Button size="sm" variant="outline" onClick={() => run(() => turnoEntrevista(m.id, null))}>
                  Retomar
                </Button>
              </div>
            )}
            {pending && m.messages.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando la próxima pregunta…
              </div>
            )}
            {m.status === "done" && m.summary && (
              <details className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <summary className="cursor-pointer font-semibold text-emerald-800">Módulo cerrado · ver síntesis</summary>
                <div className="mt-2 whitespace-pre-wrap text-emerald-900">{m.summary}</div>
              </details>
            )}
            <div ref={fin} />
          </div>

          {error && <p className="mx-4 mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          {m.status === "done" ? (
            <div className="flex flex-wrap items-center gap-2 border-t p-3">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reabrirModulo(m.id))}>
                Reabrir para seguir
              </Button>
              {modulos.some((x) => x.status !== "done") && (
                <Button
                  size="sm"
                  onClick={() => {
                    const next = modulos.find((x) => x.status !== "done")
                    if (next) setActivo(next.id)
                  }}
                >
                  Siguiente módulo
                </Button>
              )}
            </div>
          ) : (
            m.messages.length > 0 && (
              <div className="space-y-2 border-t p-3">
                <div className="flex items-end gap-2">
                  <textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        enviar()
                      }
                    }}
                    rows={2}
                    disabled={pending}
                    placeholder="Tu respuesta… (Enter envía, Shift+Enter nueva línea)"
                    className="flex-1 resize-y rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <Button disabled={pending || !texto.trim()} onClick={enviar} aria-label="Enviar">
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => turnoEntrevista(m.id, null, true))}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  Cerrar este módulo con lo que hay
                </button>
              </div>
            )
          )}
        </Card>
      ) : (
        <Card className="flex min-h-[70vh] flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <p className="font-bold">Brandbook · {brandName}</p>
              <p className="text-xs text-muted-foreground">
                Se arma con los módulos cerrados ({cerrados}/{modulos.length}). Lo podés corregir a mano antes de aprobar.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pending || cerrados === 0} onClick={() => run(() => armarBrandbook())}>
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {brandbook ? "Rearmar" : "Armar brandbook"}
              </Button>
              {brandbook && (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      if (bb !== brandbook) await guardarBrandbook(bb)
                      await aprobarBrandbook()
                    })
                  }
                >
                  <CheckCircle className="h-3.5 w-3.5" /> {brandbookStatus === "approved" ? "Volver a aprobar" : "Aprobar"}
                </Button>
              )}
            </div>
          </div>
          {error && <p className="mx-4 mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          {brandbook ? (
            <textarea
              value={bb}
              onChange={(e) => setBb(e.target.value)}
              className="min-h-[60vh] flex-1 resize-none bg-background p-4 font-mono text-[13px] leading-relaxed outline-none"
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
              {cerrados === 0
                ? "Cerrá al menos un módulo de la entrevista para armar el brandbook. Cuantos más módulos, mejor sale."
                : "Tocá «Armar brandbook»: la IA junta lo que salió de la entrevista (tarda un minuto)."}
            </div>
          )}
          {pending && <p className="border-t px-4 py-2 text-xs text-muted-foreground">Trabajando… el brandbook tarda cerca de un minuto.</p>}
        </Card>
      )}
    </div>
  )
}

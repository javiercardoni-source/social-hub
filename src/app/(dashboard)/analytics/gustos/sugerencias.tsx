"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ExternalLink, Loader2, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { marcarPautado, opinarSugerencia, pedirSugerencias } from "@/lib/cos/gustos-actions"
import { explicarError } from "@/lib/ui-errors"
import { cn } from "@/lib/utils"

export type Sugerencia = { id: string; kind: "contenido" | "material" | "musica" | "pauta"; items: unknown; feedback: "util" | "no_util" | null }
type Item = { titulo?: string; toma?: string; por_que?: string }
type Pauta = { media_id: string; objetivo: string; lift: number; confianza: string; destaca: string[]; permalink: string | null; postedAt: string; format: string }

const OBJ: Record<string, string> = { crece: "para ganar seguidores / alcance", conversa: "para generar comentarios", vende: "para vender" }
const pct = (x: number) => `+${Math.round((x - 1) * 100)} %`

function Opinar({ s }: { s: Sugerencia }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const boton = (f: "util" | "no_util") => (
    <button
      type="button"
      aria-pressed={s.feedback === f}
      aria-label={f === "util" ? "Me sirve" : "No me sirve"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            await opinarSugerencia(s.id, f)
            router.refresh()
          } catch (e) {
            setError(explicarError(e))
          }
        })
      }
      className={cn("flex min-h-9 items-center gap-1 rounded-full border px-3 text-xs font-semibold", s.feedback === f ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
    >
      {f === "util" ? <ThumbsUp className="h-3.5 w-3.5" /> : <ThumbsDown className="h-3.5 w-3.5" />}
      {f === "util" ? "Me sirve" : "No me sirve"}
    </button>
  )
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {boton("util")}
      {boton("no_util")}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

function YaLaPaute({ mediaId }: { mediaId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [hecho, setHecho] = useState(false)
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending || hecho}
      onClick={() =>
        start(async () => {
          await marcarPautado(mediaId, true)
          setHecho(true)
          router.refresh()
        })
      }
    >
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {hecho ? "Marcada como pautada" : "Ya la pauté"}
    </Button>
  )
}

export function SugerenciasSemana({ semana, sugerencias, thumbs }: { semana: string | null; sugerencias: Sugerencia[]; thumbs: Record<string, string | null> }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const de = (k: Sugerencia["kind"]) => sugerencias.find((s) => s.kind === k)
  const contenido = de("contenido")
  const material = de("material")
  const musica = de("musica")
  const pauta = de("pauta")
  const lista = (s: Sugerencia | undefined) => ((s?.items as { items?: Item[] } | null)?.items ?? []) as Item[]

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="flex-1">Esta semana{semana ? ` · desde el lunes ${new Date(`${semana}T12:00:00Z`).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "UTC" })}` : ""}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  await pedirSugerencias()
                  setMsg("Armando las sugerencias… en uno o dos minutos, recargá.")
                  setTimeout(() => router.refresh(), 60_000)
                } catch (e) {
                  setMsg(explicarError(e))
                }
              })
            }
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {sugerencias.length ? "Rehacer" : "Armar ahora"}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {msg && <p className="rounded-lg bg-muted px-3 py-2 text-xs">{msg}</p>}
        {!sugerencias.length && <p className="text-muted-foreground">Las sugerencias se arman los lunes a la mañana. Tocá «Armar ahora» para verlas ya.</p>}

        {contenido && (
          <section className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Qué hacer</p>
            {(contenido.items as { resumen?: string })?.resumen && <p>{(contenido.items as { resumen: string }).resumen}</p>}
            <ul className="space-y-1.5">
              {lista(contenido).map((i, k) => (
                <li key={k} className="rounded-lg border px-3 py-2">
                  <p className="font-medium">{i.titulo}</p>
                  {i.por_que && <p className="text-xs text-muted-foreground">{i.por_que}</p>}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">La agenda decide cuándo sale cada una.</p>
            <Opinar s={contenido} />
          </section>
        )}

        {material && lista(material).length > 0 && (
          <section className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Pedir a la cocina</p>
            <ul className="list-disc space-y-1 pl-5">
              {lista(material).map((i, k) => (
                <li key={k}>
                  {i.toma}
                  {i.por_que && <span className="text-xs text-muted-foreground"> — {i.por_que}</span>}
                </li>
              ))}
            </ul>
            <Opinar s={material} />
          </section>
        )}

        {musica && ((musica.items as { items?: string[] })?.items ?? []).length > 0 && (
          <section className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Música</p>
            <ul className="list-disc space-y-1 pl-5">
              {((musica.items as { items: string[] }).items).map((t, k) => (
                <li key={k}>{t}</li>
              ))}
            </ul>
            <Opinar s={musica} />
          </section>
        )}

        {pauta && (
          <section className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Para pautar</p>
            {((pauta.items as Pauta[]) ?? []).length === 0 ? (
              <p className="text-muted-foreground">Nada se destacó claramente en los últimos 14 días. Mejor esperar antes de poner plata.</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Publicaciones orgánicas que ya funcionaron (en sus primeras 48 h) antes de poner plata. Solo es una sugerencia: pautar lo decidís
                  vos en Meta. Cuando la pautes, tocá «Ya la pauté» para que deje de enseñarle al motor orgánico.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(pauta.items as Pauta[]).map((c) => (
                    <div key={c.media_id} className="flex gap-3 rounded-xl border p-2.5">
                      {thumbs[c.media_id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbs[c.media_id]!} alt="" className="h-20 w-16 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <div className="h-20 w-16 shrink-0 rounded-lg bg-muted" />
                      )}
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="font-semibold">
                          {pct(c.lift)} <span className="font-normal text-muted-foreground">{OBJ[c.objetivo] ?? c.objetivo}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Destaca en {c.destaca.join(", ") || "rendimiento general"} · confianza {c.confianza}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {c.permalink && (
                            <a href={c.permalink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                              Ver <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          <YaLaPaute mediaId={c.media_id} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <Opinar s={pauta} />
          </section>
        )}
      </CardContent>
    </Card>
  )
}

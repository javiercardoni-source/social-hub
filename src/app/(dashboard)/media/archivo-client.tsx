"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { agregarCarpetasBase, cambiarCarpetaBase, confirmarPermiso, descartarDelArchivo, importarInstagram, quitarCarpetaBase, traerDeBase, usarDelArchivo } from "@/lib/cos/actions"
import { TANDAS, type TipoTanda } from "../../../../shared/cos/base-fotos"
import { explicarError } from "@/lib/ui-errors"

export function ArchivoAcciones({ id, listo, usado, bloqueado = false }: { id: string; listo: boolean; usado: boolean; bloqueado?: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const run = (fn: () => Promise<void>, ok: string) =>
    start(async () => {
      setMsg(null)
      try {
        await fn()
        setMsg(ok)
        router.refresh()
      } catch (e) {
        setMsg(explicarError(e))
      }
    })
  if (usado && !bloqueado) return <p className="text-[11px] font-semibold text-emerald-700">✓ Elegido: sus borradores están en Aprobaciones</p>
  if (bloqueado) {
    return (
      <div className="space-y-1">
        <p className="rounded bg-red-50 px-1.5 py-1 text-[10px] font-semibold text-red-700">
          Tiene caras de personas: no se publica sin permiso
        </p>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            className="h-7 flex-1 text-xs"
            disabled={!listo || pending}
            onClick={() =>
              confirm(
                "¿Tenés permiso de las personas que aparecen para publicarlas en las redes de la marca?\n\nSi es alguien del equipo o te autorizaron, aceptá. Si son clientes sin permiso, cancelá y descartala.",
              ) && run(() => confirmarPermiso(id), "Armando borradores… en un par de minutos están en Aprobaciones")
            }
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" />} Tengo permiso, usar
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pending} onClick={() => run(() => descartarDelArchivo(id), "Descartado")}>
            Descartar
          </Button>
        </div>
        {msg && <p className="text-[10px] text-muted-foreground">{msg}</p>}
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <div className="flex gap-1.5">
        <Button size="sm" className="h-7 flex-1 text-xs" disabled={!listo || pending} onClick={() => run(() => usarDelArchivo(id), "Armando borradores… en un par de minutos están en Aprobaciones")}>
          {pending && <Loader2 className="h-3 w-3 animate-spin" />} Usar
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pending} onClick={() => run(() => descartarDelArchivo(id), "Descartado")}>
          Descartar
        </Button>
      </div>
      {msg && <p className="text-[10px] text-muted-foreground">{msg}</p>}
    </div>
  )
}

export function ImportarInstagram({ brandId }: { brandId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          confirm("Se van a traer al Archivo todas las publicaciones de Instagram de esta marca que falten (en alta calidad, de a poco). ¿Seguimos?") &&
          start(async () => {
            try {
              const r = await importarInstagram(brandId)
              setMsg(r.encolados ? `Trayendo ${r.encolados} publicaciones (≈ ${r.minutos} min)` : "Ya estaba todo importado")
              router.refresh()
            } catch (e) {
              setMsg(explicarError(e))
            }
          })
        }
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Traer de Instagram
      </Button>
    </div>
  )
}

export type BaseEstado = {
  at?: string
  buscando?: boolean
  error?: string | null
  pedidos?: number
  tipo?: TipoTanda
  total?: number
  fotos?: number
  videos?: number
  ya_traidos?: number
  en_camino?: number
  quedan?: number
  pesados?: number
  no_soportados?: number
  repetidos?: number
  termina?: string
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" })
const n = (x?: number) => (x ?? 0).toLocaleString("es-AR")

/**
 * Tarjeta «Traer material»: base de fotos (Drive, de a tandas) e Instagram, lado a lado.
 * Se trae de a tandas para que la IA analice de a poco y el histórico entre cuando Javier decide.
 */
export type CarpetaBase = { id: string; name: string | null }

export function TraerMaterial(props: {
  brandId: string
  brandName: string
  folderId: string | null
  folderName: string | null
  carpetas: CarpetaBase[]
  estado: BaseEstado | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [cantidad, setCantidad] = useState<number>(50)
  const [tipo, setTipo] = useState<TipoTanda>("todo")
  const [editando, setEditando] = useState(false)
  const [links, setLinks] = useState("")
  const [msg, setMsg] = useState<string | null>(null)
  const e = props.estado
  const run = (fn: () => Promise<unknown>, ok?: string) =>
    start(async () => {
      setMsg(null)
      try {
        await fn()
        if (ok) setMsg(ok)
        router.refresh()
      } catch (err) {
        setMsg(explicarError(err))
      }
    })
  const abrir = (id: string) => `https://drive.google.com/drive/folders/${id}`

  return (
    <div className="mb-5 space-y-3 rounded-xl border bg-card p-4">
      <div>
        <p className="text-sm font-bold">Traer material · {props.brandName}</p>
        {props.carpetas.length ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Base de fotos ({props.carpetas.length} carpetas):</span>
            {props.carpetas.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1 rounded-full border bg-background py-0.5 pl-2.5 pr-1">
                <a className="font-medium hover:underline" href={abrir(c.id)} target="_blank" rel="noreferrer">
                  {c.name ?? "carpeta nueva"}
                </a>
                <button
                  type="button"
                  aria-label={`Quitar ${c.name ?? "carpeta"}`}
                  disabled={pending}
                  className="rounded-full px-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                  onClick={() => confirm(`¿Sacar «${c.name ?? "esta carpeta"}» de la base? Lo ya traído queda en el Archivo.`) && run(() => quitarCarpetaBase(props.brandId, c.id))}
                >
                  ×
                </button>
              </span>
            ))}
            <button type="button" className="underline hover:text-foreground" onClick={() => setEditando((v) => !v)}>
              + agregar
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Base de fotos:{" "}
            {props.folderId ? (
              <a className="font-medium text-primary hover:underline" href={abrir(props.folderId)} target="_blank" rel="noreferrer">
                {props.folderName ?? "carpeta de Drive"}
              </a>
            ) : (
              <span className="font-medium">Content OS/00_BASE (se crea en la primera tanda)</span>
            )}{" "}
            · <button type="button" className="underline hover:text-foreground" onClick={() => setEditando((v) => !v)}>usar carpetas mías de Drive</button>
          </p>
        )}
      </div>

      {editando && (
        <div className="space-y-2">
          <textarea
            value={links}
            onChange={(ev) => setLinks(ev.target.value)}
            rows={3}
            placeholder={"Pegá uno o varios links de carpetas de Drive (uno por línea).\nTienen que estar compartidas con javiercardonibetti@gmail.com (lector alcanza)."}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending || !links.trim()}
              onClick={() =>
                run(async () => {
                  const r = await agregarCarpetasBase(props.brandId, links)
                  setLinks("")
                  setEditando(false)
                  setMsg(r.agregadas ? `${r.agregadas} carpetas agregadas` : "Esas carpetas ya estaban")
                })
              }
            >
              Agregar carpetas
            </Button>
            {(props.carpetas.length > 0 || props.folderId) && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => cambiarCarpetaBase(props.brandId, ""), "Vuelve a la carpeta de Content OS")}>
                Volver a la de Content OS
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={cantidad}
          onChange={(ev) => setCantidad(Number(ev.target.value))}
          aria-label="Cuántos traer"
          className="h-8 rounded-lg border bg-background px-2 text-sm"
        >
          {TANDAS.map((t) => (
            <option key={t} value={t}>
              {t} archivos
            </option>
          ))}
        </select>
        <select value={tipo} onChange={(ev) => setTipo(ev.target.value as TipoTanda)} aria-label="Qué traer" className="h-8 rounded-lg border bg-background px-2 text-sm">
          <option value="todo">Fotos y videos</option>
          <option value="fotos">Solo fotos</option>
          <option value="videos">Solo videos</option>
        </select>
        <Button size="sm" disabled={pending || e?.buscando} onClick={() => run(() => traerDeBase(props.brandId, cantidad, tipo))}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Traer desde base de fotos
        </Button>
        <ImportarInstagram brandId={props.brandId} />
      </div>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      {e?.buscando ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Buscando en la carpeta… (con miles de fotos tarda un minuto; recargá para ver el resultado)
        </p>
      ) : e?.error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{e.error}</p>
      ) : e?.at ? (
        <p className="text-xs text-muted-foreground">
          {e.pedidos ? (
            <>
              <b className="text-foreground">
                Tanda de {n(e.pedidos)} {e.tipo === "fotos" ? "fotos" : e.tipo === "videos" ? "videos" : "archivos"} en camino
              </b>
              {e.termina && <> · la IA termina de analizarla cerca de las {hora(e.termina)}</>}
            </>
          ) : (
            <b className="text-foreground">No hay {e.tipo === "fotos" ? "fotos nuevas" : e.tipo === "videos" ? "videos nuevos" : "nada nuevo"} para traer</b>
          )}
          {" · "}
          en la carpeta hay {n(e.fotos)} fotos y {n(e.videos)} videos · {n(e.ya_traidos)} ya traídos · quedan {n(e.quedan)}
          {e.tipo === "fotos" ? " fotos" : e.tipo === "videos" ? " videos" : ""}
          {!!e.pesados && <> · {n(e.pesados)} videos de más de 200 MB no se pueden traer</>}
          {!!e.repetidos && <> · {n(e.repetidos)} copias repetidas filtradas</>}
          {!!e.no_soportados && <> · {n(e.no_soportados)} archivos que no son fotos ni videos (ignorados)</>}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Trae las fotos más nuevas primero, de a tandas: la IA analiza solo esa tanda y aparecen acá abajo para elegir con «Usar». Nunca se mueve ni se borra nada de tu Drive.
        </p>
      )}
    </div>
  )
}

/** Pestaña «De la cocina»: material bloqueado por caras → confirmar permiso y seguir. */
export function PermisoCocina({ id }: { id: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div className="space-y-1 pt-1">
      <p className="rounded bg-red-50 px-1.5 py-1 text-[10px] font-semibold text-red-700">Tiene caras de personas: no se publica sin permiso</p>
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-full text-xs"
        disabled={pending}
        onClick={() =>
          confirm("¿Tenés permiso de las personas que aparecen para publicarlas en las redes de la marca?") &&
          start(async () => {
            setMsg(null)
            try {
              await confirmarPermiso(id)
              setMsg("Listo: los borradores van a Aprobaciones")
              router.refresh()
            } catch (e) {
              setMsg(explicarError(e))
            }
          })
        }
      >
        {pending && <Loader2 className="h-3 w-3 animate-spin" />} Tengo permiso
      </Button>
      {msg && <p className="text-[10px] text-muted-foreground">{msg}</p>}
    </div>
  )
}

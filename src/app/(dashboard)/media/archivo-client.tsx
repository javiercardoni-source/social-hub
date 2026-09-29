"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cambiarCarpetaBase, descartarDelArchivo, importarInstagram, traerDeBase, usarDelArchivo } from "@/lib/cos/actions"
import { TANDAS } from "../../../../shared/cos/base-fotos"
import { explicarError } from "@/lib/ui-errors"

export function ArchivoAcciones({ id, listo, usado }: { id: string; listo: boolean; usado: boolean }) {
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
  if (usado) return <p className="text-[11px] font-semibold text-emerald-700">✓ Elegido: sus borradores están en Aprobaciones</p>
  return (
    <div className="space-y-1">
      <div className="flex gap-1.5">
        <Button size="sm" className="h-7 flex-1 text-xs" disabled={!listo || pending} onClick={() => run(() => usarDelArchivo(id), "Armando borradores…")}>
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
  total?: number
  ya_traidos?: number
  en_camino?: number
  quedan?: number
  pesados?: number
  no_soportados?: number
  termina?: string
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" })
const n = (x?: number) => (x ?? 0).toLocaleString("es-AR")

/**
 * Tarjeta «Traer material»: base de fotos (Drive, de a tandas) e Instagram, lado a lado.
 * Se trae de a tandas para que la IA analice de a poco y el histórico entre cuando Javier decide.
 */
export function TraerMaterial(props: { brandId: string; brandName: string; folderId: string | null; folderName: string | null; estado: BaseEstado | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [cantidad, setCantidad] = useState<number>(50)
  const [editando, setEditando] = useState(false)
  const [link, setLink] = useState("")
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

  return (
    <div className="mb-5 space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold">Traer material · {props.brandName}</p>
          <p className="text-xs text-muted-foreground">
            Base de fotos:{" "}
            {props.folderId ? (
              <a className="font-medium text-primary hover:underline" href={`https://drive.google.com/drive/folders/${props.folderId}`} target="_blank" rel="noreferrer">
                {props.folderName ?? "carpeta de Drive"}
              </a>
            ) : (
              <span className="font-medium">Content OS/00_BASE (se crea en la primera tanda)</span>
            )}{" "}
            · <button type="button" className="underline hover:text-foreground" onClick={() => setEditando((v) => !v)}>cambiar carpeta</button>
          </p>
        </div>
      </div>

      {editando && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={link}
            onChange={(ev) => setLink(ev.target.value)}
            placeholder="Link de la carpeta de Drive (compartida con javiercardonibetti@gmail.com)"
            className="min-w-[260px] flex-1 rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <Button size="sm" disabled={pending || !link.trim()} onClick={() => run(async () => { await cambiarCarpetaBase(props.brandId, link); setEditando(false); setLink("") }, "Carpeta guardada")}>
            Guardar
          </Button>
          {props.folderId && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => cambiarCarpetaBase(props.brandId, ""), "Vuelve a la carpeta por defecto")}>
              Usar la de Content OS
            </Button>
          )}
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
        <Button size="sm" disabled={pending || e?.buscando} onClick={() => run(() => traerDeBase(props.brandId, cantidad))}>
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
              <b className="text-foreground">Tanda de {n(e.pedidos)} en camino</b>
              {e.termina && <> · la IA termina de analizarla cerca de las {hora(e.termina)}</>}
            </>
          ) : (
            <b className="text-foreground">No hay nada nuevo para traer</b>
          )}
          {" · "}
          {n(e.ya_traidos)} de {n(e.total)} ya traídos · quedan {n(e.quedan)}
          {!!e.pesados && <> · {n(e.pesados)} videos de más de 200 MB no se pueden traer</>}
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

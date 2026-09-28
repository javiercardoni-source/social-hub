"use client"

import { explicarError } from "@/lib/ui-errors"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { cancelarPost, pedirBorrado, volverAAprobacion } from "@/lib/cos/actions"

type Props = {
  id: string
  status: string
  platform: string
  permalink: string | null
  deleted: boolean
  deleting: boolean
  deleteFailed: boolean
}

export function AccionesPost({ id, status, platform, permalink, deleted, deleting, deleteFailed }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null)
      try {
        await fn()
        router.refresh()
      } catch (e) {
        setError(explicarError(e))
      }
    })

  if (status === "PUBLISHED") {
    if (deleted) return null
    if (deleting) {
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Borrando…
        </span>
      )
    }
    const red = platform === "instagram" ? "Instagram" : "Facebook"
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            confirm(`¿Borrar esta publicación de ${red}? La gente ya no la va a ver. No se puede deshacer.`) &&
            run(async () => {
              await pedirBorrado(id)
              // El worker lo borra en segundos: se refresca para mostrar el resultado.
              for (const ms of [3000, 5000]) {
                await new Promise((r) => setTimeout(r, ms))
                router.refresh()
              }
            })
          }
          className="flex items-center gap-1 text-xs text-red-600 hover:underline"
        >
          {pending && <Loader2 className="h-3 w-3 animate-spin" />}
          {deleteFailed ? "Reintentar borrado" : `Borrar de ${red}`}
        </button>
        {deleteFailed && permalink && (
          <a href={permalink} target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground hover:underline">
            Abrir para borrar a mano
          </a>
        )}
        {error && <p className="max-w-[200px] text-right text-[11px] text-destructive">{error}</p>}
      </div>
    )
  }

  const canCancel = ["SCHEDULED", "APPROVED", "PAUSED", "FAILED"].includes(status)
  const canReview = ["FAILED", "MISSED", "EXPIRED", "SCHEDULED", "RETRY_SCHEDULED", "PAUSED"].includes(status)
  if (!canCancel && !canReview) return null

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2 text-xs">
        {pending && <Loader2 className="h-3 w-3 animate-spin" />}
        {canReview && (
          <button type="button" disabled={pending} onClick={() => run(() => volverAAprobacion(id))} className="text-muted-foreground hover:text-foreground hover:underline">
            {status === "SCHEDULED" ? "Editar" : "Volver a aprobación"}
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            disabled={pending}
            onClick={() => confirm("¿Cancelar esta publicación? No va a salir.") && run(() => cancelarPost(id))}
            className="text-red-600 hover:underline"
          >
            Cancelar
          </button>
        )}
      </div>
      {error && <p className="max-w-[200px] text-right text-[11px] text-destructive">{error}</p>}
    </div>
  )
}

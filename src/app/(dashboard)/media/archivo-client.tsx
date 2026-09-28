"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { descartarDelArchivo, importarInstagram, usarDelArchivo } from "@/lib/cos/actions"
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
          confirm("Se van a traer al Archivo todas las publicaciones de Instagram de esta marca (en alta calidad, de a poco). ¿Seguimos?") &&
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
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Traer lo publicado en Instagram
      </Button>
    </div>
  )
}

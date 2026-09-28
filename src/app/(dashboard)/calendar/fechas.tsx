"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { agregarFecha, borrarFecha } from "@/lib/cos/actions"
import { explicarError } from "@/lib/ui-errors"

export function AgregarFecha({ brandId, brandName }: { brandId: string | null; brandName: string | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ day: "", name: "", hint: "", soloMarca: !!brandId })
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Agregar fecha
      </Button>
    )
  }
  return (
    <div className="w-full space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap gap-2">
        <input type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} className="rounded-lg border bg-background px-2 py-1.5 text-sm" />
        <input
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          placeholder="Nombre (ej: Aniversario de la marca)"
          className="min-w-[200px] flex-1 rounded-lg border bg-background px-2 py-1.5 text-sm"
        />
      </div>
      <input
        value={f.hint}
        onChange={(e) => setF({ ...f, hint: e.target.value })}
        placeholder="Idea de contenido (opcional)"
        className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm"
      />
      {brandId && (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={f.soloMarca} onChange={(e) => setF({ ...f, soloMarca: e.target.checked })} />
          Solo para {brandName} (si no, vale para todas las marcas)
        </label>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || !f.day || f.name.trim().length < 2}
          onClick={() =>
            start(async () => {
              setError(null)
              try {
                await agregarFecha({ day: f.day, name: f.name, hint: f.hint, brandId: f.soloMarca ? brandId : null })
                setF({ day: "", name: "", hint: "", soloMarca: !!brandId })
                setOpen(false)
                router.refresh()
              } catch (e) {
                setError(explicarError(e))
              }
            })
          }
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

export function BorrarFecha({ id }: { id: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      title="Borrar esta fecha"
      disabled={pending}
      onClick={() =>
        confirm("¿Borrar esta fecha?") &&
        start(async () => {
          try {
            await borrarFecha(id)
            router.refresh()
          } catch (e) {
            alert(explicarError(e))
          }
        })
      }
      className="text-muted-foreground hover:text-destructive"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  )
}

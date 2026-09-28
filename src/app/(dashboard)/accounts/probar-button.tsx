"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { probarConexion } from "@/lib/cos/account-actions"

export function ProbarConexion() {
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
          start(async () => {
            try {
              await probarConexion()
              setMsg("Probando…")
              // El worker tarda unos segundos en revisar las 6 cuentas.
              await new Promise((r) => setTimeout(r, 12_000))
              router.refresh()
              setMsg("Listo")
            } catch (e) {
              setMsg(e instanceof Error ? e.message : String(e))
            }
          })
        }
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Probar conexión
      </Button>
    </div>
  )
}

import { NextResponse, type NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * F11 · Cuenta vistas y compartidos de las vitrinas (público, sin sesión). Solo guarda qué
 * vitrina, qué anuncio, qué tipo de toque y el token opaco del empleado si llegó desde Turnos.
 * Límite por IP para que no se infle a mano.
 */
const TIPOS = new Set(["vista", "compartir", "descarga", "ver_ig"])
const UUID = /^[0-9a-f-]{36}$/
const ventana = new Map<string, { n: number; desde: number }>()

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?"
  const ahora = Date.now()
  const w = ventana.get(ip)
  if (!w || ahora - w.desde > 60_000) ventana.set(ip, { n: 1, desde: ahora })
  else if (++w.n > 60) return new NextResponse(null, { status: 429 })
  if (ventana.size > 5000) ventana.clear()

  const b = (await req.json().catch(() => null)) as { v?: string; i?: string | null; t?: string; e?: string | null } | null
  if (!b?.v || !UUID.test(b.v) || !b.t || !TIPOS.has(b.t) || (b.i && !UUID.test(b.i))) return new NextResponse(null, { status: 400 })
  const empleado = b.e && /^[A-Za-z0-9_-]{4,80}$/.test(b.e) ? b.e : null
  const db = createAdminClient()
  // Una vitrina o ítem que no existe da error de clave foránea: se ignora (no hay nada que contar).
  await db.from("cos_vitrina_events").insert({ vitrina_id: b.v, item_id: b.i ?? null, tipo: b.t, empleado })
  return new NextResponse(null, { status: 204 })
}

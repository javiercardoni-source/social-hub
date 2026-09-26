// ─────────────────────────────────────────────────────────────────────────────
// ARGOS — parte SERVER, configurada para Social Hub.
//
// MODO CENTRAL-ONLY (decidido el 2026-09-26): la base de Social Hub es OlivosSpeed,
// COMPARTIDA con otras apps, y no queremos una tabla `error_reports` ni un bucket
// propios mezclados ahí. `getServiceClient()` tira a propósito: la API de Argos
// captura ese error, se saltea el guardado local y manda el reporte directo al panel
// unificado (argos.kitchcocenter.com/errores) con ARGOS_CENTRAL_URL + ARGOS_CENTRAL_TOKEN.
// Consecuencia: el /errores propio de Social Hub no lista nada; se usa el central.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server"
import { getMember } from "@/lib/cos/auth"
import type { SupabaseClient } from "@supabase/supabase-js"

export const PROJECT_NAME = "social-hub"
export const BUCKET = "error-screenshots"
export const TABLE = "error_reports"

export function getServiceClient(): SupabaseClient {
  throw new Error("Argos en modo central-only: Social Hub no guarda reportes en su base")
}

// Crear un reporte: cualquier miembro de Content OS.
export async function requireUser(): Promise<{ id: string } | NextResponse> {
  const member = await getMember()
  if (!member) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  return { id: member.userId }
}

// Listar / resolver: solo admin de Content OS.
export async function requireAdminUser(): Promise<{ id: string } | NextResponse> {
  const member = await getMember()
  if (!member) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (member.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  return { id: member.userId }
}

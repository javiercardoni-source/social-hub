import { createAdminClient } from "@/lib/supabase/admin"

// Siempre en vivo: es lo que consulta el deploy para saber si la app ANDA.
export const dynamic = "force-dynamic"

/**
 * Salud de Social Hub: variables presentes y la base respondiendo con las tablas de
 * Content OS. No devuelve ningún valor secreto, solo sí/no por chequeo.
 */
export async function GET() {
  const checks: Record<string, boolean> = {
    supabase_env: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    service_role_env: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    db: false,
  }

  if (checks.supabase_env && checks.service_role_env) {
    try {
      const { data, error } = await createAdminClient().from("cos_settings").select("safe_mode").maybeSingle()
      checks.db = !error && data?.safe_mode === true
    } catch {
      checks.db = false
    }
  }

  const ok = Object.values(checks).every(Boolean)
  return Response.json({ ok, checks }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } })
}

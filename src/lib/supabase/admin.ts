import "server-only"
import { createClient } from "@supabase/supabase-js"

/**
 * Cliente con la llave de servicio: se saltea RLS. Solo para acciones de servidor que
 * YA verificaron el rol con `requireMember()`. Nunca se importa desde un componente
 * de cliente (`server-only` hace fallar el build si alguien lo intenta).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

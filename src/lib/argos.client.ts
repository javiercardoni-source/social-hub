// ─────────────────────────────────────────────────────────────────────────────
// ARGOS — parte CLIENT (navegador), configurada para Social Hub.
// Gatea la página /errores con el mismo criterio que requireAdminUser: admin de
// Content OS (cos_members). En modo central-only esa página no lista nada; los
// reportes se ven en argos.kitchcocenter.com/errores.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient as createBrowserClient } from "@/lib/supabase/client"

export async function isBrowserUserAdmin(): Promise<boolean> {
  const supabase = createBrowserClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    window.location.href = "/login"
    return false
  }

  // La RLS de cos_members solo deja leer a los miembros: un ajeno recibe null.
  const { data } = await supabase.from("cos_members").select("role").eq("user_id", user.id).maybeSingle()
  if (data?.role !== "admin") {
    window.location.href = "/"
    return false
  }
  return true
}

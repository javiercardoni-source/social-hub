"use server"

import { aviso } from "@/lib/aviso"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/cos/auth"

/** Encola la prueba de tokens de todas las cuentas (la corre el worker en segundos). */
export async function probarConexion() {
  await requireMember("approver")
  const { error } = await createAdminClient().rpc("cos_enqueue_job", {
    p_type: "accounts:check",
    p_payload: {},
    p_dedupe_key: "accounts:check:manual",
  })
  if (error) throw aviso(`No se pudo pedir la prueba: ${error.message}`)
}

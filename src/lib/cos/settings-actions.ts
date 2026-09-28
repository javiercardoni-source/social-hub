"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/cos/auth"

/** Pausa general: con true el worker no publica nada (los posts quedan esperando). */
export async function cambiarPausa(pausar: boolean) {
  const member = await requireMember("approver")
  const db = createAdminClient()
  const { error } = await db
    .from("cos_settings")
    .update({ global_pause: pausar, updated_by: member.userId })
    .eq("id", true)
  if (error) throw new Error(`No se pudo cambiar la pausa: ${error.message}`)
  await db.from("cos_audit_log").insert({
    event: pausar ? "settings:pause_on" : "settings:pause_off",
    entity_type: "settings",
    actor: member.email ?? member.userId,
  })
  revalidatePath("/", "layout")
}

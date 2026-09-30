"use server"

import { revalidatePath } from "next/cache"
import { aviso } from "@/lib/aviso"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"

/** F7 M3: útil / no útil de una sugerencia (el motor aprende qué sugerencias sirven). */
export async function opinarSugerencia(id: string, feedback: "util" | "no_util") {
  const member = await requireMember("approver")
  if (!["util", "no_util"].includes(feedback)) throw aviso("Opción inválida")
  const brand = await getActiveBrand()
  const db = createAdminClient()
  let q = db.from("cos_suggestions").update({ feedback, feedback_at: new Date().toISOString(), feedback_by: member.userId }).eq("id", id)
  if (brand) q = q.eq("brand_id", brand.id)
  const { error } = await q
  if (error) throw aviso(`No se pudo guardar: ${error.message}`)
  revalidatePath("/analytics/gustos")
}

/**
 * «Ya la pauté»: una publicación pautada infla el alcance y deja de enseñarle al motor orgánico
 * (se mide aparte). Se puede deshacer.
 */
export async function marcarPautado(mediaId: string, pautado: boolean) {
  await requireMember("approver")
  const brand = await getActiveBrand()
  const db = createAdminClient()
  let q = db.from("cos_media").update({ pautado }).eq("id", mediaId)
  if (brand) q = q.eq("brand_id", brand.id)
  const { data, error } = await q.select("id")
  if (error) throw aviso(`No se pudo guardar: ${error.message}`)
  if (!data?.length) throw aviso("Esa publicación no es de esta marca")
  revalidatePath("/analytics/gustos")
}

/** Arma (o rehace) las sugerencias de esta semana ya, sin esperar al lunes. */
export async function pedirSugerencias() {
  await requireMember("approver")
  const brand = await getActiveBrand()
  if (!brand) throw aviso("Elegí una marca arriba a la izquierda")
  const db = createAdminClient()
  const { error } = await db.rpc("cos_enqueue_job", { p_type: "taste:suggest", p_payload: { brand_id: brand.id, rehacer: true }, p_dedupe_key: `taste:suggest:${brand.id}:ya` })
  if (error) throw aviso(`No se pudo pedir: ${error.message}`)
}

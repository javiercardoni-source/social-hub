"use server"

import { revalidatePath } from "next/cache"
import { aviso } from "@/lib/aviso"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { normalizarEstilo } from "../../../shared/cos/grilla"

/** Guarda el estilo de la grilla (regla por columna) de la marca activa. */
export async function guardarEstiloGrilla(estilo: unknown) {
  await requireMember("approver")
  const brand = await getActiveBrand()
  if (!brand) throw aviso("Elegí una marca arriba a la izquierda")
  const { error } = await createAdminClient().from("cos_brands").update({ grid_style: normalizarEstilo(estilo) }).eq("id", brand.id)
  if (error) throw aviso(`No se pudo guardar el estilo: ${error.message}`)
  revalidatePath("/feed")
}

/** Pide a la IA que mire la grilla de la marca activa (lo hace el worker: feed:analyze). */
export async function analizarFeed(conPendientes: boolean) {
  await requireMember("approver")
  const brand = await getActiveBrand()
  if (!brand) throw aviso("Elegí una marca arriba a la izquierda")
  const db = createAdminClient()
  const { error } = await db.rpc("cos_enqueue_job", {
    p_type: "feed:analyze",
    p_payload: { brand_id: brand.id, con_pendientes: !!conPendientes },
    p_run_at: new Date().toISOString(),
    p_dedupe_key: `feed:${brand.id}`,
  })
  if (error) throw aviso(`No se pudo pedir el análisis: ${error.message}`)
  await db.from("cos_brands").update({ feed_analisis: { status: "analizando" } }).eq("id", brand.id)
  revalidatePath("/feed")
}

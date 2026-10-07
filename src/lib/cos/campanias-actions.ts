"use server"

import { revalidatePath } from "next/cache"
import { aviso } from "@/lib/aviso"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { leerRitmo } from "../../../shared/cos/agenda"
import { validarCampania, type Campania } from "../../../shared/cos/campanias"

/**
 * Calendario (07-10-2026): el ritmo de publicación de la marca y sus campañas por temporada.
 * Cambiar el ritmo reacomoda lo pendiente en el momento (la agenda corre adelante en la cola).
 */

async function marcaActiva() {
  const member = await requireMember("approver")
  const brand = await getActiveBrand()
  if (!brand) throw aviso("Elegí una marca arriba a la izquierda")
  return { member, brand, db: createAdminClient() }
}

async function reacomodar(db: ReturnType<typeof createAdminClient>, brandId: string) {
  await db.rpc("cos_enqueue_job", {
    p_type: "agenda:plan",
    p_payload: { brand_id: brandId },
    p_run_at: new Date(Date.now() - 3600_000).toISOString(),
    p_dedupe_key: `agenda:plan:${brandId}:ritmo:${Math.floor(Date.now() / 60_000)}`,
  })
}

export async function guardarRitmo(postsSemana: number, historiasDia: number) {
  const { brand, db } = await marcaActiva()
  const ritmo = leerRitmo({ postsSemana, historiasDia })
  const { error } = await db.from("cos_brands").update({ ritmo }).eq("id", brand.id)
  if (error) throw aviso(`No se pudo guardar: ${error.message}`)
  await reacomodar(db, brand.id)
  revalidatePath("/calendar")
}

const UUID = /^[0-9a-f-]{36}$/

export async function guardarCampania(id: string | null, datos: Partial<Record<keyof Campania, unknown>>) {
  const { brand, db } = await marcaActiva()
  const c = validarCampania(datos)
  if (typeof c === "string") throw aviso(c)
  if (id) {
    if (!UUID.test(id)) throw aviso("Campaña inválida")
    const { error } = await db.from("cos_campaigns").update(c).eq("id", id).eq("brand_id", brand.id)
    if (error) throw aviso(`No se pudo guardar: ${error.message}`)
  } else {
    const { error } = await db.from("cos_campaigns").insert({ ...c, brand_id: brand.id })
    if (error) throw aviso(`No se pudo guardar: ${error.message}`)
  }
  revalidatePath("/calendar")
}

export async function activarCampania(id: string, activa: boolean) {
  const { brand, db } = await marcaActiva()
  if (!UUID.test(id)) throw aviso("Campaña inválida")
  const { error } = await db.from("cos_campaigns").update({ activa }).eq("id", id).eq("brand_id", brand.id)
  if (error) throw aviso(`No se pudo guardar: ${error.message}`)
  revalidatePath("/calendar")
}

export async function borrarCampania(id: string) {
  const { brand, db } = await marcaActiva()
  if (!UUID.test(id)) throw aviso("Campaña inválida")
  const { error } = await db.from("cos_campaigns").delete().eq("id", id).eq("brand_id", brand.id)
  if (error) throw aviso(`No se pudo borrar: ${error.message}`)
  revalidatePath("/calendar")
}

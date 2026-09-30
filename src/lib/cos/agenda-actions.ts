"use server"

import { revalidatePath } from "next/cache"
import { aviso } from "@/lib/aviso"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { normalizarApertura } from "../../../shared/cos/agenda"

/**
 * F8 · Agenda en Marca: llaves por marca y horarios de apertura (la IA los lee de la web; Javier
 * los confirma). Todo por marca: cada una se prende sola.
 */
async function marca() {
  const member = await requireMember("approver")
  const brand = await getActiveBrand()
  if (!brand) throw aviso("Elegí una marca arriba a la izquierda")
  return { member, brand, db: createAdminClient() }
}

export async function cambiarLlaveAgenda(campo: "agenda_auto" | "clima_historias", valor: boolean) {
  if (!["agenda_auto", "clima_historias"].includes(campo)) throw aviso("Llave inválida")
  const { brand, db } = await marca()
  const { error } = await db.from("cos_brands").update({ [campo]: valor }).eq("id", brand.id)
  if (error) throw aviso(`No se pudo guardar: ${error.message}`)
  // Recién prendida: que ubique ya lo que está esperando aprobación.
  if (campo === "agenda_auto" && valor) {
    await db.rpc("cos_enqueue_job", { p_type: "agenda:plan", p_payload: { brand_id: brand.id }, p_dedupe_key: `agenda:plan:${brand.id}:ya` })
  }
  // Apagada: lo pendiente pierde la hora del motor (vuelve a elegirse a mano al aprobar).
  if (campo === "agenda_auto" && !valor) {
    await db
      .from("cos_posts")
      .update({ scheduled_at: null, window_start: null, window_end: null, schedule_source: null, schedule_reason: null, predicted_lift: null })
      .eq("brand_id", brand.id)
      .eq("status", "PENDING_APPROVAL")
      .in("schedule_source", ["motor", "exploracion"])
  }
  revalidatePath("/marca")
  revalidatePath("/aprobaciones")
}

/** Pide a la IA que lea los horarios de la web (y de Datos vigentes). Queda como propuesta. */
export async function leerHorariosDeLaWeb() {
  const { brand, db } = await marca()
  const { error } = await db.rpc("cos_enqueue_job", { p_type: "brand:hours", p_payload: { brand_id: brand.id }, p_dedupe_key: `brand:hours:${brand.id}` })
  if (error) throw aviso(`No se pudo pedir: ${error.message}`)
}

/**
 * Guarda los horarios confirmados. Texto por día (0 = domingo): "19:00-23:30, 12:00-15:00" o vacío
 * si no abre. Lo que no se entiende se rechaza con el día.
 */
export async function guardarHorarios(porDia: string[]) {
  const { brand, db } = await marca()
  if (!Array.isArray(porDia) || porDia.length !== 7) throw aviso("Faltan días")
  const raw: Record<string, { desde: string; hasta: string }[]> = {}
  const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
  porDia.forEach((texto, d) => {
    const turnos = (texto ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
    raw[String(d)] = turnos.map((t) => {
      const m = /^(\d{1,2}(?::\d{2})?)\s*(?:-|a|–)\s*(\d{1,2}(?::\d{2})?)$/.exec(t)
      if (!m) throw aviso(`No entiendo el horario del ${DIAS[d]}: «${t}». Escribilo como 19:00-23:30`)
      const hm = (x: string) => (x.includes(":") ? x : `${x}:00`)
      return { desde: hm(m[1]), hasta: hm(m[2]) }
    })
  })
  const ap = normalizarApertura(raw)
  const { error } = await db.from("cos_brands").update({ open_hours: ap }).eq("id", brand.id)
  if (error) throw aviso(`No se pudo guardar: ${error.message}`)
  revalidatePath("/marca")
}

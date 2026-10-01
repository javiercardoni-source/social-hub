"use server"

/**
 * F11 · Vitrinas — lo que hace Javier desde Anuncios → Vitrinas. La web no arma nada: crea la fila
 * y deja vitrina:build en la cola. Aprobar avisa al equipo en Turnos (V2).
 */
import { revalidatePath } from "next/cache"
import { aviso } from "@/lib/aviso"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { slugVitrina } from "../../../shared/cos/vitrina"

async function marca() {
  const b = await getActiveBrand()
  if (!b) throw aviso("Elegí una marca arriba a la izquierda")
  return b
}

/** Arma una vitrina con los anuncios de una campaña de Meta (pegás el ID de la campaña). */
export async function armarVitrina(campaignId: string, titulo: string, bajada: string) {
  const member = await requireMember("approver")
  const b = await marca()
  const id = campaignId.trim()
  if (!/^\d{6,25}$/.test(id)) throw aviso("El ID de la campaña son solo números (Administrador de anuncios → columna «Identificador»)")
  const t = titulo.trim() || `${b.name} · anuncios`
  const db = createAdminClient()
  // Si ya hay una de esa campaña, se re-arma la misma (el link no cambia).
  const { data: ya } = await db.from("cos_vitrinas").select("id").eq("brand_id", b.id).eq("meta_campaign_id", id).neq("estado", "retirada").maybeSingle()
  let vid = ya?.id as string | undefined
  if (vid) {
    await db.from("cos_vitrinas").update({ titulo: t, bajada: bajada.trim(), estado: "armando", error: null, updated_at: new Date().toISOString() }).eq("id", vid)
  } else {
    const { data, error } = await db
      .from("cos_vitrinas")
      .insert({ brand_id: b.id, slug: slugVitrina(t), titulo: t, bajada: bajada.trim(), origen: "campaña", meta_campaign_id: id })
      .select("id")
      .single()
    if (error) throw aviso(`No se pudo crear: ${error.message}`)
    vid = data.id as string
  }
  const { error: e2 } = await db.rpc("cos_enqueue_job", { p_type: "vitrina:build", p_payload: { vitrina_id: vid }, p_dedupe_key: `vitrina:build:${vid}:${Date.now()}` })
  if (e2) throw aviso(`No se pudo encolar: ${e2.message}`)
  await db.from("cos_audit_log").insert({ event: "vitrina:armar", entity_type: "vitrina", entity_id: vid, actor: member.email ?? member.userId, details_json: { campaign: id } })
  revalidatePath("/anuncios")
}

async function deLaMarca(id: string) {
  const b = await marca()
  const db = createAdminClient()
  const { data } = await db.from("cos_vitrinas").select("id, estado").eq("id", id).eq("brand_id", b.id).maybeSingle()
  if (!data) throw aviso("Esa vitrina no es de esta marca")
  return { db, v: data }
}

export async function editarVitrina(id: string, titulo: string, bajada: string) {
  await requireMember("approver")
  const { db } = await deLaMarca(id)
  if (!titulo.trim()) throw aviso("El título no puede quedar vacío")
  await db.from("cos_vitrinas").update({ titulo: titulo.trim().slice(0, 120), bajada: bajada.trim().slice(0, 400), updated_at: new Date().toISOString() }).eq("id", id)
  revalidatePath("/anuncios")
}

/** Aprobar: pasa a ser la vigente de la marca y se avisa al equipo en Turnos. */
export async function aprobarVitrina(id: string) {
  const member = await requireMember("approver")
  const { db, v } = await deLaMarca(id)
  if (v.estado !== "lista") throw aviso("Solo se aprueba una vitrina lista")
  await db.from("cos_vitrinas").update({ estado: "aprobada", approved_by: member.userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id)
  await db.rpc("cos_enqueue_job", { p_type: "vitrina:turnos", p_payload: { vitrina_id: id }, p_dedupe_key: `vitrina:turnos:${id}` })
  await db.from("cos_audit_log").insert({ event: "vitrina:aprobada", entity_type: "vitrina", entity_id: id, actor: member.email ?? member.userId, details_json: {} })
  revalidatePath("/anuncios")
}

export async function rearmarVitrina(id: string) {
  await requireMember("approver")
  const { db, v } = await deLaMarca(id)
  if (v.estado === "retirada") throw aviso("Está retirada")
  await db.rpc("cos_enqueue_job", { p_type: "vitrina:build", p_payload: { vitrina_id: id }, p_dedupe_key: `vitrina:build:${id}:${Date.now()}` })
  revalidatePath("/anuncios")
}

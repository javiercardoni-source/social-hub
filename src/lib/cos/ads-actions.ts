"use server"

/**
 * F10 · Motor de ADS — lo que hace Javier desde «Anuncios» (docs/PLAN-MOTOR-ADS.md, E4).
 * La web no habla con Meta: aprueba y deja el trabajo ads:create en la cola. El worker crea
 * todo PAUSADO; prender es de Javier, desde Meta.
 */
import { revalidatePath } from "next/cache"
import { aviso } from "@/lib/aviso"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { problemasCopy } from "../../../shared/cos/ads"
import { normalizarDatos } from "../../../shared/cos/datos-vigentes"

async function propuestaDeLaMarca(id: string) {
  const brand = await getActiveBrand()
  if (!brand) throw aviso("Elegí una marca arriba a la izquierda")
  const db = createAdminClient()
  const { data, error } = await db.from("cos_ad_proposals").select("id, status, brand_id").eq("id", id).eq("brand_id", brand.id).maybeSingle()
  if (error) throw aviso(`No se pudo leer la propuesta: ${error.message}`)
  if (!data) throw aviso("Esa propuesta no es de esta marca")
  return { db, p: data, brand }
}

/** Aprobar (con lo que Javier haya editado) → se crea en Meta, PAUSADO. */
export async function aprobarPropuesta(id: string, cambios: { title: string; body: string; daily_budget: number | null }) {
  const member = await requireMember("approver")
  const { db, p } = await propuestaDeLaMarca(id)
  if (p.status !== "propuesta") throw aviso("Esta propuesta ya no está para aprobar")
  const title = cambios.title.trim()
  const body = cambios.body.trim()
  const { data: marca } = await db.from("cos_brands").select("datos_vigentes").eq("id", p.brand_id).single()
  const precios = normalizarDatos(marca?.datos_vigentes).combos.filter((c) => c.activo && c.precio).map((c) => c.precio)
  const probs = problemasCopy({ title, body }, precios)
  if (probs.length) throw aviso(`Revisá el texto: ${probs.join("; ")}`)
  const budget = cambios.daily_budget
  if (budget != null && (!Number.isFinite(budget) || budget < 1000 || budget > 500_000)) throw aviso("El presupuesto diario tiene que estar entre $1.000 y $500.000")
  const { error } = await db
    .from("cos_ad_proposals")
    .update({ title, body, daily_budget: budget, status: "aprobada", approved_by: member.userId, approved_at: new Date().toISOString(), error: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "propuesta")
  if (error) throw aviso(`No se pudo aprobar: ${error.message}`)
  const { error: e2 } = await db.rpc("cos_enqueue_job", { p_type: "ads:create", p_payload: { proposal_id: id }, p_dedupe_key: `ads:create:${id}:inicio` })
  if (e2) throw aviso(`Quedó aprobada pero no se pudo encolar: ${e2.message}`)
  await db.from("cos_audit_log").insert({ event: "ads:aprobada", entity_type: "ad_proposal", entity_id: id, actor: member.email ?? member.userId, details_json: { title, daily_budget: budget } })
  revalidatePath("/anuncios")
}

export async function descartarPropuesta(id: string) {
  const member = await requireMember("approver")
  const { db, p } = await propuestaDeLaMarca(id)
  if (!["propuesta", "error", "preparando"].includes(p.status)) throw aviso("Esta propuesta ya se está creando en Meta")
  const { error } = await db.from("cos_ad_proposals").update({ status: "descartada", updated_at: new Date().toISOString() }).eq("id", id)
  if (error) throw aviso(`No se pudo descartar: ${error.message}`)
  await db.from("cos_audit_log").insert({ event: "ads:descartada", entity_type: "ad_proposal", entity_id: id, actor: member.email ?? member.userId, details_json: {} })
  revalidatePath("/anuncios")
}

/**
 * Reintentar lo que falló: si ya estaba aprobada (falló en Meta), sigue desde el último paso hecho;
 * si falló armando la pieza, se vuelve a armar.
 */
export async function reintentarPropuesta(id: string) {
  await requireMember("approver")
  const { db, p } = await propuestaDeLaMarca(id)
  if (p.status !== "error") throw aviso("Solo se reintenta lo que falló")
  const { data } = await db.from("cos_ad_proposals").select("approved_at, pieces").eq("id", id).single()
  const aprobada = !!data?.approved_at
  const sinPieza = !Array.isArray(data?.pieces) || data.pieces.length === 0
  const status = aprobada ? "aprobada" : sinPieza ? "preparando" : "propuesta"
  const { error } = await db.from("cos_ad_proposals").update({ status, error: null, updated_at: new Date().toISOString() }).eq("id", id)
  if (error) throw aviso(`No se pudo reintentar: ${error.message}`)
  const tipo = aprobada ? "ads:create" : sinPieza ? "ads:piece" : null
  if (tipo) await db.rpc("cos_enqueue_job", { p_type: tipo, p_payload: { proposal_id: id }, p_dedupe_key: `${tipo}:${id}:reintento:${Date.now()}` })
  revalidatePath("/anuncios")
}

/** Arma (o rehace) la tanda de esta semana ya, sin esperar al lunes. Lo aprobado y lo creado queda. */
export async function pedirTanda() {
  await requireMember("approver")
  const brand = await getActiveBrand()
  if (!brand) throw aviso("Elegí una marca arriba a la izquierda")
  const db = createAdminClient()
  const { error } = await db.rpc("cos_enqueue_job", { p_type: "ads:batch", p_payload: { brand_id: brand.id, rehacer: true }, p_dedupe_key: `ads:batch:${brand.id}:ya` })
  if (error) throw aviso(`No se pudo pedir: ${error.message}`)
}

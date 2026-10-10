"use server"

/**
 * Sets de anuncios a pedido (Anuncios → «Crear set», 10-10-2026). La web guarda el pedido y deja
 * el trabajo en la cola; el worker elige el material real, escribe las versiones y arma las piezas
 * (ads:set → ads:set-version). Es un set para descargar: no toca Meta.
 */
import { revalidatePath } from "next/cache"
import { aviso } from "@/lib/aviso"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { validarPedido } from "../../../shared/cos/ad-sets"

const UUID = /^[0-9a-f-]{36}$/

async function setDeLaMarca(id: string) {
  if (!UUID.test(id)) throw aviso("Set inválido")
  const brand = await getActiveBrand()
  if (!brand) throw aviso("Elegí una marca arriba a la izquierda")
  const db = createAdminClient()
  const { data, error } = await db.from("cos_ad_sets").select("id, estado").eq("id", id).eq("brand_id", brand.id).maybeSingle()
  if (error) throw aviso(`No se pudo leer el set: ${error.message}`)
  if (!data) throw aviso("Ese set no es de esta marca")
  return { db, set: data }
}

export async function crearSet(input: { textos: string; detalles: string; versiones: number; formato: string; fuentes: string[]; elegidos: { origen: string; id: string }[] }) {
  const member = await requireMember("editor")
  const brand = await getActiveBrand()
  if (!brand) throw aviso("Elegí una marca arriba a la izquierda")
  const p = validarPedido(input)
  if (typeof p === "string") throw aviso(p)
  const db = createAdminClient()
  const { data: row, error } = await db
    .from("cos_ad_sets")
    .insert({ brand_id: brand.id, textos: p.textos, detalles: p.detalles, versiones: p.versiones, formato: p.formato, fuentes: p.fuentes, elegidos: p.elegidos, created_by: member.userId })
    .select("id")
    .single()
  if (error || !row) throw aviso(`No se pudo guardar: ${error?.message ?? "sin respuesta"}`)
  const { error: e2 } = await db.rpc("cos_enqueue_job", { p_type: "ads:set", p_payload: { set_id: row.id }, p_dedupe_key: `ads:set:${row.id}:inicio` })
  if (e2) throw aviso(`Quedó guardado pero no se pudo pedir: ${e2.message}`)
  await db.from("cos_audit_log").insert({ event: "ads:set", entity_type: "ad_set", entity_id: row.id, actor: member.email ?? member.userId, details_json: { textos: p.textos, versiones: p.versiones, formato: p.formato, fuentes: p.fuentes } })
  revalidatePath("/anuncios")
}

/** Rehace el set entero: vuelve a elegir material y a escribir las versiones. */
export async function rehacerSet(id: string) {
  await requireMember("editor")
  const { db, set } = await setDeLaMarca(id)
  if (set.estado === "preparando") throw aviso("Ya se está preparando")
  await db.from("cos_ad_set_versiones").delete().eq("set_id", id)
  const { error } = await db.from("cos_ad_sets").update({ estado: "preparando", error: null, material: [], motivo: null }).eq("id", id)
  if (error) throw aviso(`No se pudo rehacer: ${error.message}`)
  await db.rpc("cos_enqueue_job", { p_type: "ads:set", p_payload: { set_id: id }, p_dedupe_key: `ads:set:${id}:${Date.now()}` })
  revalidatePath("/anuncios")
}

/** Vuelve a armar una sola versión (mismo texto y material: sirve si falló). */
export async function rehacerVersion(versionId: string) {
  await requireMember("editor")
  if (!UUID.test(versionId)) throw aviso("Versión inválida")
  const db = createAdminClient()
  const { data: v } = await db.from("cos_ad_set_versiones").select("id, set_id, estado").eq("id", versionId).maybeSingle()
  if (!v) throw aviso("Esa versión no existe")
  await setDeLaMarca(v.set_id as string)
  if (v.estado === "armando") throw aviso("Ya se está armando")
  await db.from("cos_ad_set_versiones").update({ estado: "armando", error: null }).eq("id", versionId)
  await db.from("cos_ad_sets").update({ estado: "armando" }).eq("id", v.set_id)
  await db.rpc("cos_enqueue_job", { p_type: "ads:set-version", p_payload: { version_id: versionId }, p_dedupe_key: `ads:set-version:${versionId}:${Date.now()}` })
  revalidatePath("/anuncios")
}

/** Borra el set y sus archivos. */
export async function borrarSet(id: string) {
  await requireMember("editor")
  const { db } = await setDeLaMarca(id)
  // Los archivos viven bajo ads/sets/<id>/<job>/…: se listan las carpetas de cada armado.
  const bucket = db.storage.from("cos-media")
  const { data: carpetas } = await bucket.list(`ads/sets/${id}`, { limit: 100 })
  for (const c of carpetas ?? []) {
    const dir = `ads/sets/${id}/${c.name}`
    const [{ data: archivos }, { data: material }] = await Promise.all([bucket.list(dir, { limit: 100 }), bucket.list(`${dir}/material`, { limit: 100 })])
    const keys = [...(archivos ?? []).filter((a) => a.id).map((a) => `${dir}/${a.name}`), ...(material ?? []).map((a) => `${dir}/material/${a.name}`)]
    if (keys.length) await bucket.remove(keys)
  }
  const { error } = await db.from("cos_ad_sets").delete().eq("id", id)
  if (error) throw aviso(`No se pudo borrar: ${error.message}`)
  revalidatePath("/anuncios")
}

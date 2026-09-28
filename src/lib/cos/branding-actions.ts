"use server"

import { aviso } from "@/lib/aviso"
import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { interviewTurn, synthesizeBrandbook, type BrandRow, type ChatMsg } from "@/lib/cos/branding"
import { BRAND_MODULE_IDS, type BrandModuleId } from "../../../shared/cos/brand-modules"

async function contexto() {
  const member = await requireMember("approver")
  const active = await getActiveBrand()
  if (!active) throw aviso("Elegí una marca arriba a la izquierda")
  const db = createAdminClient()
  const { data: brand, error } = await db
    .from("cos_brands")
    .select("id, slug, name, tone_md, rules_json, whatsapp_number")
    .eq("id", active.id)
    .single()
  if (error || !brand) throw aviso("Marca no encontrada")
  const { data: rows } = await db.from("cos_brand_interviews").select("module, messages, summary_md, status").eq("brand_id", brand.id)
  return { member, db, brand: brand as BrandRow, rows: rows ?? [] }
}

function validModule(m: string): BrandModuleId {
  if (!BRAND_MODULE_IDS.includes(m as BrandModuleId)) throw aviso("Módulo inválido")
  return m as BrandModuleId
}

/**
 * Un turno de la entrevista. `texto` null = arrancar el módulo (la IA hace la primera pregunta).
 * `cerrar` = pedir la síntesis ya.
 */
export async function turnoEntrevista(moduleId: string, texto: string | null, cerrar = false) {
  const mod = validModule(moduleId)
  const { db, brand, rows } = await contexto()
  const row = rows.find((r) => r.module === mod)
  if (row?.status === "done" && !cerrar) throw aviso("Este módulo ya está cerrado. Reabrilo para seguir.")

  // Los mensajes vacíos (una respuesta de la IA que no llegó) no se guardan ni se reenvían.
  const messages: ChatMsg[] = ((row?.messages as ChatMsg[] | undefined) ?? []).filter((x) => typeof x.content === "string" && x.content.trim())
  const now = () => new Date().toISOString()
  if (texto?.trim()) messages.push({ role: "user", content: texto.trim().slice(0, 4000), at: now() })

  const done = rows.filter((r) => r.status === "done" && r.module !== mod).map((r) => ({ module: r.module, summary_md: r.summary_md }))
  const { reply, summary } = await interviewTurn({ db, brand, module: mod, messages, done, forzarCierre: cerrar })
  messages.push({ role: "assistant", content: reply, at: now() })

  const { error } = await db.from("cos_brand_interviews").upsert(
    {
      brand_id: brand.id,
      module: mod,
      messages,
      ...(summary ? { summary_md: summary, status: "done" } : { status: "in_progress" }),
    },
    { onConflict: "brand_id,module" },
  )
  if (error) throw aviso(`No se pudo guardar la entrevista: ${error.message}`)
  revalidatePath("/marca")
  return { closed: !!summary }
}

export async function reabrirModulo(moduleId: string) {
  const mod = validModule(moduleId)
  const { db, brand } = await contexto()
  await db.from("cos_brand_interviews").update({ status: "in_progress" }).eq("brand_id", brand.id).eq("module", mod)
  revalidatePath("/marca")
}

export async function armarBrandbook() {
  const { db, brand, rows, member } = await contexto()
  const done = rows.filter((r) => r.status === "done").map((r) => ({ module: r.module, summary_md: r.summary_md }))
  if (done.length === 0) throw aviso("Cerrá al menos un módulo de la entrevista antes de armar el brandbook")
  const md = await synthesizeBrandbook({ db, brand, done })
  const { error } = await db.from("cos_brands").update({ brandbook_md: md, brandbook_status: "draft" }).eq("id", brand.id)
  if (error) throw aviso(`No se pudo guardar el brandbook: ${error.message}`)
  await db.from("cos_audit_log").insert({ event: "brandbook:drafted", entity_type: "brand", entity_id: brand.id, actor: member.email ?? member.userId })
  revalidatePath("/marca")
}

export async function guardarBrandbook(md: string) {
  const { db, brand } = await contexto()
  if (md.trim().length < 200) throw aviso("El brandbook quedó demasiado corto")
  await db.from("cos_brands").update({ brandbook_md: md.trim(), brandbook_status: "draft" }).eq("id", brand.id)
  revalidatePath("/marca")
}

/** Aprobado, el brandbook pasa a ser la fuente de la IA (tone_md). */
export async function aprobarBrandbook() {
  const { db, brand, member } = await contexto()
  const { data } = await db.from("cos_brands").select("brandbook_md").eq("id", brand.id).single()
  if (!data?.brandbook_md) throw aviso("No hay brandbook para aprobar")
  const { error } = await db
    .from("cos_brands")
    .update({
      tone_md: data.brandbook_md,
      brandbook_status: "approved",
      brandbook_approved_at: new Date().toISOString(),
      brandbook_approved_by: member.userId,
    })
    .eq("id", brand.id)
  if (error) throw aviso(`No se pudo aprobar: ${error.message}`)
  await db.from("cos_audit_log").insert({ event: "brandbook:approved", entity_type: "brand", entity_id: brand.id, actor: member.email ?? member.userId })
  revalidatePath("/marca")
}

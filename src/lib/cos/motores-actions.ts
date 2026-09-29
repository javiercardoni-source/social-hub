"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { aviso } from "@/lib/aviso"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { KINDS, extDe, validarArchivo, type KindMotor } from "../../../shared/cos/motores"

/**
 * Marca → Motores: lo que cada marca le da a los motores visuales (referencias de estilo,
 * tipografías, logo y su biblioteca de sonido). El archivo va del navegador directo a cos-media
 * con una URL firmada; después se registra y, si corresponde, la IA lo analiza.
 */

async function marcaActiva() {
  const member = await requireMember("approver")
  const brand = await getActiveBrand()
  if (!brand) throw aviso("Elegí una marca arriba a la izquierda")
  return { member, brand, db: createAdminClient() }
}

function carpeta(kind: KindMotor, slug: string) {
  return kind === "musica" ? `music/${slug}` : `brand/${slug}/${kind}`
}

export async function prepararSubidaMotor(input: { kind: KindMotor; name: string; size: number }) {
  const { brand, db } = await marcaActiva()
  if (!KINDS.includes(input.kind)) throw aviso("Tipo inválido")
  const problema = validarArchivo(input.kind, input.name, input.size)
  if (problema) throw aviso(problema)
  const ext = extDe(input.name)
  // La música conserva su nombre (es lo que se ve en Aprobaciones); el resto, un id.
  const base =
    input.kind === "musica"
      ? `${input.name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "tema"}-${randomUUID().slice(0, 6)}`
      : randomUUID()
  const key = `${carpeta(input.kind, brand.slug)}/${base}.${ext}`
  const { data, error } = await db.storage.from("cos-media").createSignedUploadUrl(key)
  if (error || !data) throw aviso(`No se pudo preparar la subida: ${error?.message}`)
  return { key, token: data.token }
}

/** Primeros bytes de un archivo ya subido (para confirmar que es lo que dice ser). */
async function cabecera(db: ReturnType<typeof createAdminClient>, key: string): Promise<Buffer> {
  const { data, error } = await db.storage.from("cos-media").download(key)
  if (error || !data) throw aviso(`No encuentro el archivo subido: ${error?.message}`)
  return Buffer.from(await data.slice(0, 32).arrayBuffer())
}

/** Los borradores pendientes de la marca se vuelven a armar (tipografía o logo nuevos). */
async function rearmarPendientes(db: ReturnType<typeof createAdminClient>, brandId: string) {
  const { data } = await db
    .from("cos_posts")
    .update({ render_key: null, render_qa: null })
    .eq("brand_id", brandId)
    .eq("status", "PENDING_APPROVAL")
    .select("id")
  for (const p of data ?? []) {
    await db.rpc("cos_enqueue_job", { p_type: "post:render", p_payload: { post_id: p.id }, p_run_at: new Date().toISOString(), p_dedupe_key: `render:${p.id}` })
  }
  return data?.length ?? 0
}

export async function registrarMotor(input: { kind: KindMotor; key: string; name: string; size: number; note?: string }) {
  const { member, brand, db } = await marcaActiva()
  if (!KINDS.includes(input.kind)) throw aviso("Tipo inválido")
  // La key la generó prepararSubidaMotor para esta marca y este tipo.
  if (!input.key.startsWith(`${carpeta(input.kind, brand.slug)}/`) || input.key.includes("..")) throw aviso("Subida inválida")

  if (input.kind === "musica") {
    revalidatePath("/marca")
    return { rearmados: 0 }
  }

  const head = await cabecera(db, input.key)
  const problema = validarArchivo(input.kind, input.name, input.size, head)
  if (problema) {
    await db.storage.from("cos-media").remove([input.key])
    throw aviso(problema)
  }

  // Tipografías y logo: uno vigente por marca → el anterior se reemplaza.
  if (input.kind !== "referencia") {
    const { data: viejos } = await db.from("cos_brand_assets").select("id, storage_key").eq("brand_id", brand.id).eq("kind", input.kind)
    if (viejos?.length) {
      await db.from("cos_brand_assets").delete().in("id", viejos.map((v) => v.id))
      await db.storage.from("cos-media").remove(viejos.map((v) => v.storage_key))
    }
  }

  const mime = input.kind === "referencia" ? mimeReferencia(input.name) : input.kind === "logo" ? "image/png" : `font/${extDe(input.name)}`
  const { data: row, error } = await db
    .from("cos_brand_assets")
    .insert({
      brand_id: brand.id,
      kind: input.kind,
      name: input.name.slice(0, 200),
      storage_key: input.key,
      mime,
      size_bytes: input.size,
      note: input.note?.trim().slice(0, 500) || null,
      status: input.kind === "referencia" ? "analizando" : "lista",
      created_by: member.userId,
    })
    .select("id")
    .single()
  if (error || !row) throw aviso(`No se pudo guardar: ${error?.message}`)

  let rearmados = 0
  if (input.kind === "referencia") {
    await db.rpc("cos_enqueue_job", { p_type: "ref:analyze", p_payload: { ref_id: row.id }, p_run_at: new Date().toISOString(), p_dedupe_key: `ref:${row.id}` })
  } else {
    rearmados = await rearmarPendientes(db, brand.id)
  }
  revalidatePath("/marca")
  revalidatePath("/aprobaciones")
  return { rearmados }
}

function mimeReferencia(name: string) {
  const ext = extDe(name)
  return ext === "mp4" ? "video/mp4" : ext === "mov" ? "video/quicktime" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg"
}

/** Borra una referencia, tipografía o logo. Sin tipografía/logo propios, vuelven los de siempre. */
export async function borrarMotor(id: string) {
  const { brand, db } = await marcaActiva()
  const { data: r } = await db.from("cos_brand_assets").select("id, kind, storage_key").eq("id", id).eq("brand_id", brand.id).maybeSingle()
  if (!r) throw aviso("Ya no estaba")
  await db.from("cos_brand_assets").delete().eq("id", id)
  await db.storage.from("cos-media").remove([r.storage_key])
  const rearmados = r.kind === "referencia" ? 0 : await rearmarPendientes(db, brand.id)
  revalidatePath("/marca")
  return { rearmados }
}

/** Vuelve a pedir la ficha de estilo (si falló o cambió la nota). */
export async function reanalizarReferencia(id: string, note?: string) {
  const { brand, db } = await marcaActiva()
  const { data, error } = await db
    .from("cos_brand_assets")
    .update({ status: "analizando", error: null, ...(note !== undefined ? { note: note.trim().slice(0, 500) || null } : {}) })
    .eq("id", id)
    .eq("brand_id", brand.id)
    .eq("kind", "referencia")
    .select("id")
  if (error || !data?.length) throw aviso("No se pudo volver a analizar")
  await db.rpc("cos_enqueue_job", { p_type: "ref:analyze", p_payload: { ref_id: id }, p_run_at: new Date().toISOString(), p_dedupe_key: `ref:${id}` })
  revalidatePath("/marca")
}

/** Saca un tema de la biblioteca de sonido de la marca (los borradores que ya lo usan no cambian). */
export async function borrarMusica(key: string) {
  const { brand, db } = await marcaActiva()
  if (!key.startsWith(`music/${brand.slug}/`) || key.includes("..")) throw aviso("Tema inválido")
  const { count } = await db
    .from("cos_posts")
    .select("id", { count: "exact", head: true })
    .eq("music_key", key)
    .in("status", ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "PUBLISHING"])
  if (count) throw aviso(`Ese tema lo usan ${count} publicaciones que todavía no salieron: cambiales la música o esperá a que se publiquen.`)
  const { error } = await db.storage.from("cos-media").remove([key])
  if (error) throw aviso(`No se pudo borrar: ${error.message}`)
  revalidatePath("/marca")
}

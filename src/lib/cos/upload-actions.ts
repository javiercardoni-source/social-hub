"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/cos/auth"

// Carga manual (PLAN §7): mismo circuito que el envío desde la PWA de Turnos, con source = manual.
// El archivo va directo del navegador a cos-media con una URL firmada de subida;
// después se registra el asset y el worker hace el resto.

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
}
const MAX_BYTES = 500 * 1024 * 1024
const MIN_DESCRIPTION = 15

export async function prepararSubida(input: { brandSlug: string; mime: string; size: number }) {
  await requireMember("editor")
  const ext = MIME_EXT[input.mime]
  if (!ext) return { error: "Formato no soportado. Usá JPG, PNG, WebP, HEIC, MP4 o MOV." }
  if (input.size > MAX_BYTES) return { error: "El archivo pesa más de 500 MB." }

  const db = createAdminClient()
  const { data: brand } = await db.from("cos_brands").select("slug").eq("slug", input.brandSlug).eq("active", true).maybeSingle()
  if (!brand) return { error: "Marca no válida." }

  const key = `originals/${brand.slug}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`
  const { data, error } = await db.storage.from("cos-media").createSignedUploadUrl(key)
  if (error || !data) return { error: `No se pudo preparar la subida: ${error?.message}` }
  return { key, token: data.token }
}

export async function registrarSubida(input: { brandSlug: string; key: string; mime: string; size: number; description: string }) {
  const member = await requireMember("editor")
  const description = input.description.trim()
  if (description.length < MIN_DESCRIPTION) return { error: `La descripción necesita al menos ${MIN_DESCRIPTION} caracteres.` }
  if (!MIME_EXT[input.mime]) return { error: "Formato no soportado." }
  // La key la generó prepararSubida: se verifica que sea de esa marca y de la carpeta de originales.
  if (!new RegExp(`^originals/${input.brandSlug}/\\d{4}-\\d{2}/[0-9a-f-]{36}\\.[a-z0-9]+$`).test(input.key)) {
    return { error: "Subida inválida." }
  }

  const db = createAdminClient()
  const { data: brand } = await db.from("cos_brands").select("id").eq("slug", input.brandSlug).single()
  if (!brand) return { error: "Marca no válida." }

  const { data: asset, error } = await db
    .from("cos_assets")
    .insert({
      brand_id: brand.id,
      source: "manual",
      source_external_id: `manual:${input.key}`,
      description,
      submitted_by_label: member.displayName ?? member.email ?? "Carga manual",
      mime: input.mime,
      size_bytes: input.size,
      storage_driver: "supabase",
      storage_key: input.key,
      status: "NEW",
    })
    .select("id")
    .single()
  if (error || !asset) return { error: `No se pudo registrar: ${error?.message}` }

  const { error: je } = await db.rpc("cos_enqueue_job", {
    p_type: "asset:process",
    p_payload: { asset_id: asset.id },
    p_dedupe_key: `process:${asset.id}`,
  })
  if (je) return { error: `Quedó guardado pero no se pudo encolar: ${je.message}` }

  revalidatePath("/media")
  revalidatePath("/inicio")
  return { assetId: asset.id }
}

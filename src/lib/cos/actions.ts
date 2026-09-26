"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/cos/auth"

// ── crear post desde un asset ────────────────────────────────────────────────

export async function crearPost(formData: FormData) {
  const member = await requireMember("editor")
  const assetId = formData.get("asset_id") as string
  const accountId = formData.get("account_id") as string
  const platform = formData.get("platform") as string
  const postType = formData.get("post_type") as string
  const caption = formData.get("caption") as string
  const hashtags = (formData.get("hashtags") as string) ?? ""
  const scheduledAt = formData.get("scheduled_at") as string | null

  if (!assetId || !accountId || !platform || !postType) {
    throw new Error("Faltan campos requeridos")
  }

  const db = createAdminClient()

  // Traer el asset para saber la marca y la versión actual
  const { data: asset, error: ae } = await db
    .from("cos_assets")
    .select("brand_id, current_version_id")
    .eq("id", assetId)
    .single()
  if (ae || !asset) throw new Error("Asset no encontrado")
  if (!asset.current_version_id) throw new Error("El asset no tiene versión procesada todavía")

  // Crear el post en DRAFT
  const { data: post, error: pe } = await db
    .from("cos_posts")
    .insert({
      brand_id: asset.brand_id,
      account_id: accountId,
      platform,
      post_type: postType,
      caption,
      hashtags,
      scheduled_at: scheduledAt || null,
      status: "DRAFT",
      created_by: member.userId,
    })
    .select("id")
    .single()
  if (pe || !post) throw new Error(`No se pudo crear el post: ${pe?.message}`)

  // Vincular el asset al post
  const { error: me } = await db.from("cos_post_media").insert({
    post_id: post.id,
    version_id: asset.current_version_id,
    position: 0,
  })
  if (me) throw new Error(`No se pudo vincular el archivo: ${me.message}`)

  // Pasar a PENDING_APPROVAL de inmediato (la base sella el hash en APPROVED más adelante)
  const { error: te } = await db
    .from("cos_posts")
    .update({ status: "PENDING_APPROVAL" })
    .eq("id", post.id)
  if (te) throw new Error(`No se pudo enviar a revisión: ${te.message}`)

  revalidatePath("/aprobaciones")
  revalidatePath("/inicio")
  redirect("/aprobaciones")
}

// ── aprobar post ─────────────────────────────────────────────────────────────

export async function aprobarPost(postId: string) {
  const member = await requireMember("approver")
  const db = createAdminClient()

  // PENDING_APPROVAL → APPROVED (sella el hash en la base)
  const { error: ae } = await db
    .from("cos_posts")
    .update({ status: "APPROVED", approved_by: member.userId, approved_at: new Date().toISOString() })
    .eq("id", postId)
  if (ae) throw new Error(`No se pudo aprobar: ${ae.message}`)

  // APPROVED → SCHEDULED (el worker lo publica en scheduled_at)
  const { error: se } = await db
    .from("cos_posts")
    .update({ status: "SCHEDULED" })
    .eq("id", postId)
  if (se) throw new Error(`No se pudo programar: ${se.message}`)

  revalidatePath("/aprobaciones")
  revalidatePath("/inicio")
}

// ── rechazar post ────────────────────────────────────────────────────────────

export async function rechazarPost(postId: string, motivo: string) {
  await requireMember("approver")
  const db = createAdminClient()

  const { error } = await db
    .from("cos_posts")
    .update({ status: "REJECTED", last_error: motivo || "Rechazado" })
    .eq("id", postId)
  if (error) throw new Error(`No se pudo rechazar: ${error.message}`)

  revalidatePath("/aprobaciones")
  revalidatePath("/inicio")
}

// ── cancelar post ────────────────────────────────────────────────────────────

export async function cancelarPost(postId: string) {
  await requireMember("editor")
  const db = createAdminClient()

  const { error } = await db
    .from("cos_posts")
    .update({ status: "CANCELLED" })
    .eq("id", postId)
  if (error) throw new Error(`No se pudo cancelar: ${error.message}`)

  revalidatePath("/aprobaciones")
  revalidatePath("/inicio")
  revalidatePath("/calendar")
}

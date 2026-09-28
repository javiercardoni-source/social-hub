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

/** Edita el texto de un post que todavía espera aprobación. */
const TEMPLATES = ["none", "banda", "etiqueta", "firma"]

export async function editarPost(
  postId: string,
  caption: string,
  hashtags: string,
  overlay = "",
  template = "none",
  music: string | null = null,
) {
  await requireMember("editor")
  if (caption.length + hashtags.length > 2200) throw new Error("El texto supera los 2200 caracteres de Instagram")
  if (!TEMPLATES.includes(template)) throw new Error("Plantilla inválida")
  const db = createAdminClient()
  const { data: before } = await db.from("cos_posts").select("overlay_text, template, music_key, cos_brands(slug)").eq("id", postId).single()
  const slug = (before?.cos_brands as unknown as { slug: string } | null)?.slug
  // Solo temas de la biblioteca de ESA marca.
  if (music && !music.startsWith(`music/${slug}/`)) throw new Error("Tema de música inválido")
  const visualChanged = before?.overlay_text !== overlay.trim() || before?.template !== template || (before?.music_key ?? null) !== music
  const { data, error } = await db
    .from("cos_posts")
    .update({
      caption: caption.trim(),
      hashtags: hashtags.replace(/\s+/g, " ").trim(),
      overlay_text: overlay.trim().slice(0, 80),
      template,
      music_key: music,
      // La pieza final vieja ya no corresponde: el worker arma la nueva.
      ...(visualChanged ? { render_key: null } : {}),
    })
    .eq("id", postId)
    .eq("status", "PENDING_APPROVAL")
    .select("id")
  if (error) throw new Error(`No se pudo guardar: ${error.message}`)
  if (!data?.length) throw new Error("Este post ya no está esperando aprobación")
  if (visualChanged) {
    // Sin clave de dedupe: si ya había uno corriendo con el contenido anterior, este arma el nuevo.
    await db.rpc("cos_enqueue_job", { p_type: "post:render", p_payload: { post_id: postId } })
  }
  revalidatePath("/aprobaciones")
}

/**
 * Aprueba. `cuando` = fecha ISO para programarlo, o null para "apenas apruebe".
 * La fecha se fija ANTES de aprobar porque entra en el hash de lo aprobado.
 */
export async function aprobarPost(postId: string, cuando: string | null = null) {
  const member = await requireMember("approver")
  const db = createAdminClient()

  const target = cuando ? new Date(cuando) : null
  if (target && Number.isNaN(target.getTime())) throw new Error("Fecha inválida")
  // "Ya" (o una fecha que está encima) se deja 2 min adelante para que el reloj no lo dé
  // por vencido mientras se aprueba; igual se encola ya mismo (abajo).
  const publishNow = !target || target.getTime() <= Date.now() + 2 * 60_000
  const { error: fe } = await db
    .from("cos_posts")
    .update({ scheduled_at: publishNow ? new Date(Date.now() + 2 * 60_000).toISOString() : target!.toISOString() })
    .eq("id", postId)
    .eq("status", "PENDING_APPROVAL")
  if (fe) throw new Error(`No se pudo fijar el horario: ${fe.message}`)

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

  if (publishNow) {
    // Misma clave que usa el reloj: si él también lo encola, no se duplica.
    const { error: je } = await db.rpc("cos_enqueue_job", {
      p_type: "post:publish",
      p_payload: { post_id: postId },
      p_dedupe_key: `publish:${postId}`,
    })
    if (je) throw new Error(`Quedó programado pero no se pudo encolar: ${je.message}`)
  }

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

// ── devolver a aprobación (un post que falló o se perdió) ────────────────────

export async function volverAAprobacion(postId: string) {
  await requireMember("approver")
  const db = createAdminClient()
  const { data, error } = await db
    .from("cos_posts")
    .update({ status: "PENDING_APPROVAL", scheduled_at: null })
    .eq("id", postId)
    .in("status", ["FAILED", "MISSED", "EXPIRED", "SCHEDULED", "RETRY_SCHEDULED", "PAUSED"])
    .select("id")
  if (error) throw new Error(`No se pudo devolver a aprobación: ${error.message}`)
  if (!data?.length) throw new Error("Este post ya no se puede devolver a aprobación")
  revalidatePath("/calendar")
  revalidatePath("/aprobaciones")
}

// ── borrar de la red un post publicado (lo hace el worker: trabajo post:delete) ─────────

export async function pedirBorrado(postId: string) {
  const member = await requireMember("approver")
  const db = createAdminClient()
  const { data, error } = await db
    .from("cos_posts")
    .update({ delete_requested_at: new Date().toISOString(), delete_requested_by: member.userId, delete_error: null })
    .eq("id", postId)
    .eq("status", "PUBLISHED")
    .is("deleted_at", null)
    .select("id")
  if (error) throw new Error(`No se pudo pedir el borrado: ${error.message}`)
  if (!data?.length) throw new Error("Este post no está publicado o ya se borró")
  const { error: je } = await db.rpc("cos_enqueue_job", {
    p_type: "post:delete",
    p_payload: { post_id: postId },
    p_dedupe_key: `delete:${postId}`,
  })
  if (je) throw new Error(`No se pudo encolar el borrado: ${je.message}`)
  await db.from("cos_audit_log").insert({ event: "post:delete_requested", entity_type: "post", entity_id: postId, actor: member.email ?? member.userId })
  revalidatePath("/calendar")
}

// ── rehacer con IA (lo hace el worker: trabajo post:redo) ────────────────────

export async function rehacerConIA(postIds: string[], pedido: string, otroDiseno: boolean, otraMusica: boolean) {
  const member = await requireMember("editor")
  if (!postIds.length) throw new Error("No hay nada para rehacer")
  const db = createAdminClient()
  const { data, error } = await db.from("cos_posts").select("id").in("id", postIds).eq("status", "PENDING_APPROVAL")
  if (error) throw new Error(`No se pudo rehacer: ${error.message}`)
  if (!data?.length) throw new Error("Estas publicaciones ya no esperan aprobación")
  const { error: je } = await db.rpc("cos_enqueue_job", {
    p_type: "post:redo",
    p_payload: {
      post_ids: data.map((p) => p.id),
      request: pedido.slice(0, 500),
      otro_diseno: otroDiseno,
      otra_musica: otraMusica,
      by: member.email ?? member.userId,
    },
  })
  if (je) throw new Error(`No se pudo pedir: ${je.message}`)
}

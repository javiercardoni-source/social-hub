"use server"

import { TANDAS, TIPOS, carpetaDeLink, type TipoTanda } from "../../../shared/cos/base-fotos"
import { aviso } from "@/lib/aviso"
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
    throw aviso("Faltan campos requeridos")
  }

  const db = createAdminClient()

  // Traer el asset para saber la marca y la versión actual
  const { data: asset, error: ae } = await db
    .from("cos_assets")
    .select("brand_id, current_version_id")
    .eq("id", assetId)
    .single()
  if (ae || !asset) throw aviso("Asset no encontrado")
  if (!asset.current_version_id) throw aviso("El asset no tiene versión procesada todavía")

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
  if (pe || !post) throw aviso(`No se pudo crear el post: ${pe?.message}`)

  // Vincular el asset al post
  const { error: me } = await db.from("cos_post_media").insert({
    post_id: post.id,
    version_id: asset.current_version_id,
    position: 0,
  })
  if (me) throw aviso(`No se pudo vincular el archivo: ${me.message}`)

  // Pasar a PENDING_APPROVAL de inmediato (la base sella el hash en APPROVED más adelante)
  const { error: te } = await db
    .from("cos_posts")
    .update({ status: "PENDING_APPROVAL" })
    .eq("id", post.id)
  if (te) throw aviso(`No se pudo enviar a revisión: ${te.message}`)

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
  position: "auto" | "top" | "bottom" = "auto",
) {
  await requireMember("editor")
  if (caption.length + hashtags.length > 2200) throw aviso("El texto supera los 2200 caracteres de Instagram")
  if (!TEMPLATES.includes(template)) throw aviso("Plantilla inválida")
  if (!["auto", "top", "bottom"].includes(position)) throw aviso("Posición inválida")
  const db = createAdminClient()
  const { data: before } = await db.from("cos_posts").select("overlay_text, template, music_key, overlay_position, cos_brands(slug)").eq("id", postId).single()
  const slug = (before?.cos_brands as unknown as { slug: string } | null)?.slug
  // Solo temas de la biblioteca de ESA marca.
  if (music && !music.startsWith(`music/${slug}/`)) throw aviso("Tema de música inválido")
  const visualChanged =
    before?.overlay_text !== overlay.trim() ||
    before?.template !== template ||
    (before?.music_key ?? null) !== music ||
    before?.overlay_position !== position
  const { data, error } = await db
    .from("cos_posts")
    .update({
      caption: caption.trim(),
      hashtags: hashtags.replace(/\s+/g, " ").trim(),
      overlay_text: overlay.trim().slice(0, 80),
      template,
      music_key: music,
      overlay_position: position,
      // La pieza vieja ya no corresponde: el worker arma la nueva y la vuelve a revisar.
      // Si Javier eligió posición a mano, esa es la posición; en "auto" la decide la revisión.
      ...(visualChanged ? { render_key: null, render_qa: null, overlay_layout: position === "auto" ? null : position } : {}),
    })
    .eq("id", postId)
    .eq("status", "PENDING_APPROVAL")
    .select("id")
  if (error) throw aviso(`No se pudo guardar: ${error.message}`)
  if (!data?.length) throw aviso("Este post ya no está esperando aprobación")
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
  if (target && Number.isNaN(target.getTime())) throw aviso("Fecha inválida")

  // Se aprueba lo que se vio: si la pieza final todavía se está armando o revisando, no se aprueba
  // (si no, se publicaría una versión que nadie miró).
  const { data: pieza } = await db.from("cos_posts").select("render_qa").eq("id", postId).single()
  if (!pieza?.render_qa) throw aviso("La pieza final todavía se está armando y revisando. Esperá unos segundos y recargá.")
  // "Ya" (o una fecha que está encima) se deja 2 min adelante para que el reloj no lo dé
  // por vencido mientras se aprueba; igual se encola ya mismo (abajo).
  const publishNow = !target || target.getTime() <= Date.now() + 2 * 60_000
  const { error: fe } = await db
    .from("cos_posts")
    .update({ scheduled_at: publishNow ? new Date(Date.now() + 2 * 60_000).toISOString() : target!.toISOString() })
    .eq("id", postId)
    .eq("status", "PENDING_APPROVAL")
  if (fe) throw aviso(`No se pudo fijar el horario: ${fe.message}`)

  // PENDING_APPROVAL → APPROVED (sella el hash en la base)
  const { error: ae } = await db
    .from("cos_posts")
    .update({ status: "APPROVED", approved_by: member.userId, approved_at: new Date().toISOString() })
    .eq("id", postId)
  if (ae) throw aviso(`No se pudo aprobar: ${ae.message}`)

  // APPROVED → SCHEDULED (el worker lo publica en scheduled_at)
  const { error: se } = await db
    .from("cos_posts")
    .update({ status: "SCHEDULED" })
    .eq("id", postId)
  if (se) throw aviso(`No se pudo programar: ${se.message}`)

  if (publishNow) {
    // Misma clave que usa el reloj: si él también lo encola, no se duplica.
    const { error: je } = await db.rpc("cos_enqueue_job", {
      p_type: "post:publish",
      p_payload: { post_id: postId },
      p_dedupe_key: `publish:${postId}`,
    })
    if (je) throw aviso(`Quedó programado pero no se pudo encolar: ${je.message}`)
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
  if (error) throw aviso(`No se pudo rechazar: ${error.message}`)

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
  if (error) throw aviso(`No se pudo cancelar: ${error.message}`)

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
  if (error) throw aviso(`No se pudo devolver a aprobación: ${error.message}`)
  if (!data?.length) throw aviso("Este post ya no se puede devolver a aprobación")
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
  if (error) throw aviso(`No se pudo pedir el borrado: ${error.message}`)
  if (!data?.length) throw aviso("Este post no está publicado o ya se borró")
  const { error: je } = await db.rpc("cos_enqueue_job", {
    p_type: "post:delete",
    p_payload: { post_id: postId },
    p_dedupe_key: `delete:${postId}`,
  })
  if (je) throw aviso(`No se pudo encolar el borrado: ${je.message}`)
  await db.from("cos_audit_log").insert({ event: "post:delete_requested", entity_type: "post", entity_id: postId, actor: member.email ?? member.userId })
  revalidatePath("/calendar")
}

// ── rehacer con IA (lo hace el worker: trabajo post:redo) ────────────────────

export async function rehacerConIA(postIds: string[], pedido: string, otroDiseno: boolean, otraMusica: boolean) {
  const member = await requireMember("editor")
  if (!postIds.length) throw aviso("No hay nada para rehacer")
  const db = createAdminClient()
  const { data, error } = await db.from("cos_posts").select("id").in("id", postIds).eq("status", "PENDING_APPROVAL")
  if (error) throw aviso(`No se pudo rehacer: ${error.message}`)
  if (!data?.length) throw aviso("Estas publicaciones ya no esperan aprobación")
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
  if (je) throw aviso(`No se pudo pedir: ${je.message}`)
}

// ── fechas especiales propias (F4) ───────────────────────────────────────────

export async function agregarFecha(input: { day: string; name: string; brandId: string | null; hint: string }) {
  const member = await requireMember("editor")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) throw aviso("Fecha inválida")
  const name = input.name.trim()
  if (name.length < 2 || name.length > 80) throw aviso("El nombre tiene que tener entre 2 y 80 caracteres")
  const db = createAdminClient()
  const { error } = await db.from("cos_special_days").insert({
    day: input.day,
    name,
    kind: input.brandId ? "marca" : "evento",
    brand_id: input.brandId,
    source: "manual",
    hint: input.hint.trim().slice(0, 300) || null,
    created_by: member.userId,
  })
  if (error) throw aviso(/duplicate|unique/i.test(error.message) ? "Esa fecha ya está cargada" : `No se pudo guardar: ${error.message}`)
  revalidatePath("/calendar")
}

export async function borrarFecha(id: string) {
  await requireMember("editor")
  const db = createAdminClient()
  // Solo las cargadas a mano: los feriados y las fechas curadas se mantienen solos.
  const { data, error } = await db.from("cos_special_days").delete().eq("id", id).eq("source", "manual").select("id")
  if (error) throw aviso(`No se pudo borrar: ${error.message}`)
  if (!data?.length) throw aviso("Solo se pueden borrar las fechas cargadas a mano")
  revalidatePath("/calendar")
}

// ── Archivo (F2) ─────────────────────────────────────────────────────────────

/** "Usar": el material de archivo pasa a la cocina de posts (la IA arma los borradores). */
export async function usarDelArchivo(assetId: string) {
  await requireMember("editor")
  const db = createAdminClient()
  const { data: a } = await db.from("cos_assets").select("consent").eq("id", assetId).single()
  if (a?.consent === "blocked") throw aviso("Tiene caras de personas: tocá «Tengo permiso, usar» si tenés autorización para publicarlas.")
  const { data, error } = await db
    .from("cos_assets")
    .update({ review_status: "approved" })
    .eq("id", assetId)
    .in("review_status", ["pending", "approved"])
    .in("status", ["READY", "IN_USE"])
    .select("id")
  if (error) throw aviso(`No se pudo marcar: ${error.message}`)
  if (!data?.length) throw aviso("Todavía se está analizando: probá en un rato")
  const { error: je } = await db.rpc("cos_enqueue_job", { p_type: "post:draft", p_payload: { asset_id: assetId }, p_dedupe_key: `draft:${assetId}` })
  if (je) throw aviso(`No se pudo pedir los borradores: ${je.message}`)
  revalidatePath("/media")
}

/**
 * Javier confirma que hay permiso para publicar a las personas que aparecen (la IA lo había
 * bloqueado por caras). Queda en la auditoría quién lo confirmó. Si ya estaba elegido del
 * Archivo o vino de la cocina, se arman los borradores.
 */
export async function confirmarPermiso(assetId: string, usar = true) {
  const member = await requireMember("approver")
  const db = createAdminClient()
  const { data, error } = await db
    .from("cos_assets")
    .update({ consent: "ok", ...(usar ? { review_status: "approved" } : {}) })
    .eq("id", assetId)
    .eq("consent", "blocked")
    .select("id, source, review_status, status")
  if (error) throw aviso(`No se pudo confirmar: ${error.message}`)
  if (!data?.length) throw aviso("Ese material ya no estaba bloqueado")
  await db.from("cos_audit_log").insert({
    event: "asset:consent_ok",
    entity_type: "asset",
    entity_id: assetId,
    actor: member.email ?? member.userId,
  })
  const a = data[0]
  const puedeBorrador = ["manual", "turnos"].includes(a.source) || a.review_status === "approved"
  if (puedeBorrador && ["READY", "IN_USE"].includes(a.status)) {
    // Sin clave de dedupe vieja: el intento anterior ya terminó ("sin borrador" por el bloqueo).
    const { error: je } = await db.rpc("cos_enqueue_job", { p_type: "post:draft", p_payload: { asset_id: assetId }, p_dedupe_key: `draft:${assetId}` })
    if (je) throw aviso(`Permiso guardado, pero no se pudieron pedir los borradores: ${je.message}`)
  }
  revalidatePath("/media")
  revalidatePath("/aprobaciones")
}

export async function descartarDelArchivo(assetId: string) {
  await requireMember("editor")
  const db = createAdminClient()
  const { error } = await db.from("cos_assets").update({ review_status: "discarded", status: "ARCHIVED" }).eq("id", assetId).not("review_status", "is", null)
  if (error) throw aviso(`No se pudo descartar: ${error.message}`)
  revalidatePath("/media")
}

const UUID = /^[0-9a-f-]{36}$/

/** Descarta varias del Archivo de una vez (selección con tilde). No toca Drive ni Instagram. */
export async function descartarVarios(assetIds: string[]) {
  await requireMember("editor")
  const ids = [...new Set(assetIds)].filter((id) => UUID.test(id))
  if (!ids.length) throw aviso("No hay nada seleccionado")
  if (ids.length > 500) throw aviso("Son demasiadas de una vez: descartá hasta 500")
  const db = createAdminClient()
  // Solo material de archivo sin usar: lo ya elegido (con borradores) no se toca desde acá.
  const { error, count } = await db
    .from("cos_assets")
    .update({ review_status: "discarded", status: "ARCHIVED" }, { count: "exact" })
    .in("id", ids)
    .eq("review_status", "pending")
  if (error) throw aviso(`No se pudieron descartar: ${error.message}`)
  revalidatePath("/media")
  return { descartados: count ?? 0 }
}

/** Devuelve al Archivo lo descartado por error. Si no se había llegado a analizar, se analiza. */
export async function recuperarVarios(assetIds: string[]) {
  await requireMember("editor")
  const ids = [...new Set(assetIds)].filter((id) => UUID.test(id))
  if (!ids.length) throw aviso("No hay nada seleccionado")
  if (ids.length > 500) throw aviso("Son demasiadas de una vez: recuperá hasta 500")
  const db = createAdminClient()
  const { data, error } = await db.from("cos_assets").select("id, current_version_id, quality_score").in("id", ids).eq("review_status", "discarded")
  if (error) throw aviso(`No se pudieron recuperar: ${error.message}`)
  for (const a of data ?? []) {
    const procesado = !!a.current_version_id
    const { error: ue } = await db
      .from("cos_assets")
      .update({ review_status: "pending", status: procesado ? "READY" : "NEW" })
      .eq("id", a.id)
      .eq("review_status", "discarded")
    if (ue) throw aviso(`No se pudo recuperar: ${ue.message}`)
    // Lo que se descartó antes de terminar el análisis se retoma donde quedó.
    const tipo = !procesado ? "asset:process" : a.quality_score == null ? "asset:classify" : null
    if (tipo) {
      await db.rpc("cos_enqueue_job", {
        p_type: tipo,
        p_payload: { asset_id: a.id },
        p_run_at: new Date().toISOString(),
        p_dedupe_key: `${tipo === "asset:process" ? "process" : "classify"}:${a.id}`,
      })
    }
  }
  revalidatePath("/media")
  return { recuperados: data?.length ?? 0 }
}

/** Trae al Archivo lo publicado en Instagram de una marca (de a poco: uno cada 20 s). */
export async function importarInstagram(brandId: string) {
  await requireMember("approver")
  const db = createAdminClient()
  const { data: media, error } = await db
    .from("cos_media")
    .select("id, remote_id")
    .eq("brand_id", brandId)
    .eq("platform", "instagram")
    .neq("format", "story")
    .order("posted_at", { ascending: false })
  if (error) throw aviso(`No se pudo leer lo publicado: ${error.message}`)
  const { data: ya } = await db.from("cos_assets").select("source_external_id").eq("brand_id", brandId).eq("source", "instagram")
  const tengo = new Set((ya ?? []).map((a) => a.source_external_id))
  const faltan = (media ?? []).filter((m) => !tengo.has(m.remote_id))
  let at = Date.now()
  for (const m of faltan) {
    at += 20_000
    await db.rpc("cos_enqueue_job", {
      p_type: "archive:import-ig",
      p_payload: { media_id: m.id },
      p_run_at: new Date(at).toISOString(),
      p_dedupe_key: `import-ig:${m.id}`,
    })
  }
  revalidatePath("/media")
  return { encolados: faltan.length, minutos: Math.ceil((faltan.length * 20) / 60) }
}

/** Trae la próxima tanda de la base de fotos (Drive) de una marca. El worker elige y encola. */
export async function traerDeBase(brandId: string, cantidad: number, tipo: TipoTanda = "todo") {
  await requireMember("approver")
  if (!TANDAS.includes(cantidad as (typeof TANDAS)[number])) throw aviso("Cantidad inválida")
  if (!TIPOS.includes(tipo)) throw aviso("Tipo inválido")
  const db = createAdminClient()
  const { error } = await db.rpc("cos_enqueue_job", {
    p_type: "archive:scan-drive",
    p_payload: { brand_id: brandId, limite: cantidad, tipo },
    p_run_at: new Date().toISOString(),
    p_dedupe_key: `scan-drive:${brandId}`,
  })
  if (error) throw aviso(`No se pudo pedir la tanda: ${error.message}`)
  // Se limpia el estado anterior: la pantalla muestra "buscando…" hasta que el worker responda.
  await db.from("cos_brands").update({ base_estado: { at: new Date().toISOString(), buscando: true, pedidos: cantidad } }).eq("id", brandId)
  revalidatePath("/media")
}

/** Suma carpetas de Drive a la base de fotos de la marca. Acepta varios links (uno por línea). */
export async function agregarCarpetasBase(brandId: string, links: string) {
  await requireMember("approver")
  const partes = links.split(/[\s,]+/).filter(Boolean)
  const ids = partes.map(carpetaDeLink)
  const malos = partes.filter((_, i) => !ids[i])
  if (!partes.length) throw aviso("Pegá al menos un link de carpeta")
  if (malos.length) throw aviso(`Esto no parece un link de carpeta de Drive: ${malos[0].slice(0, 80)}`)
  const db = createAdminClient()
  const { data: b, error } = await db.from("cos_brands").select("base_folders").eq("id", brandId).single()
  if (error || !b) throw aviso("Marca no encontrada")
  const actuales = (Array.isArray(b.base_folders) ? b.base_folders : []) as { id: string; name?: string | null }[]
  const nuevas = [...new Set(ids as string[])].filter((id) => !actuales.some((c) => c.id === id)).map((id) => ({ id, name: null }))
  if (actuales.length + nuevas.length > 30) throw aviso("Hasta 30 carpetas por marca")
  const { error: ue } = await db.from("cos_brands").update({ base_folders: [...actuales, ...nuevas], base_estado: null }).eq("id", brandId)
  if (ue) throw aviso(`No se pudieron guardar las carpetas: ${ue.message}`)
  revalidatePath("/media")
  return { agregadas: nuevas.length }
}

/** Saca una carpeta de la base de fotos (lo ya traído de ahí queda en el Archivo). */
export async function quitarCarpetaBase(brandId: string, folderId: string) {
  await requireMember("approver")
  const db = createAdminClient()
  const { data: b, error } = await db.from("cos_brands").select("base_folders").eq("id", brandId).single()
  if (error || !b) throw aviso("Marca no encontrada")
  const actuales = (Array.isArray(b.base_folders) ? b.base_folders : []) as { id: string }[]
  const { error: ue } = await db.from("cos_brands").update({ base_folders: actuales.filter((c) => c.id !== folderId), base_estado: null }).eq("id", brandId)
  if (ue) throw aviso(`No se pudo quitar la carpeta: ${ue.message}`)
  revalidatePath("/media")
}

/** Cambia la carpeta de Drive que es la base de fotos de la marca (acepta el link de la carpeta). */
export async function cambiarCarpetaBase(brandId: string, link: string) {
  await requireMember("approver")
  const id = link.trim() ? carpetaDeLink(link) : null
  if (link.trim() && !id) throw aviso("Ese link no parece de una carpeta de Drive. Abrí la carpeta en Drive y copiá el link de la barra del navegador.")
  const db = createAdminClient()
  const { error } = await db.from("cos_brands").update({ base_folder_id: id, base_folder_name: null, base_folders: [], base_estado: null }).eq("id", brandId)
  if (error) throw aviso(`No se pudo guardar la carpeta: ${error.message}`)
  revalidatePath("/media")
}

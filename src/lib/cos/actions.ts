"use server"

import { MOTIVOS_DE_MATERIAL, validarRechazo } from "../../../shared/cos/rechazos"
import { plantilla } from "../../../shared/cos/plantillas"
import { normalizarExcluidos } from "../../../shared/cos/reel"

import { TANDAS, TIPOS, carpetaDeLink, type TipoTanda } from "../../../shared/cos/base-fotos"
import { chocaConReglas, horaHistoriaManual, huecoConReglas, leerRitmo, type Formato } from "../../../shared/cos/agenda"
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
  const { data: before } = await db.from("cos_posts").select("overlay_text, template, music_key, overlay_position, montaje, pick_json, cos_brands(slug)").eq("id", postId).single()
  // Reel del motor (F9): el texto es el gancho (mayúsculas) y no hay plantilla ni posición.
  if (before?.montaje) {
    overlay = overlay.toUpperCase().slice(0, 40)
    template = "none"
    position = "auto"
  }
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
      // F7 M2: si Javier cambia la música que eligió el motor, queda registrado (señal de gusto de marca).
      ...(before?.pick_json && (before.music_key ?? null) !== music
        ? { pick_json: { ...(before.pick_json as Record<string, unknown>), override: { motor: before.music_key, javier: music, at: new Date().toISOString() } } }
        : {}),
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
 * Aprueba. `cuando`:
 *   "motor" → sale en el horario que eligió la agenda (F8) y se aprueba su ventana: el motor lo
 *             puede reacomodar dentro de ella si cambia el pronóstico (nunca a menos de 3 h).
 *   fecha   → a esa hora exacta, fijada a mano (🔒: el motor no la toca).
 *   null    → apenas apruebe.
 * La fecha se fija ANTES de aprobar porque entra en el hash de lo aprobado.
 */
/** Lo aprobado o publicado de una cuenta alrededor de una fecha (para las reglas de la agenda). */
async function ocupadosDeCuenta(db: ReturnType<typeof createAdminClient>, accountId: string, sinPost: string, cerca: Date) {
  // Una semana para atrás y 120 días para adelante: el ritmo es semanal y la búsqueda de hueco puede ir lejos.
  const desde = new Date(cerca.getTime() - 8 * 24 * 3600_000).toISOString()
  const { data: otros } = await db
    .from("cos_posts")
    .select("post_type, scheduled_at, published_at")
    .eq("account_id", accountId)
    .neq("id", sinPost)
    .in("status", ["APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "RETRY_SCHEDULED"])
    .or(`scheduled_at.gte.${desde},published_at.gte.${desde}`)
  return (otros ?? []).map((o) => ({ account: accountId, format: o.post_type as Formato, at: (o.published_at ?? o.scheduled_at) as string })).filter((o) => !!o.at)
}

export async function aprobarPost(postId: string, cuando: string | null | "motor" = null, vistoAt?: string) {
  const member = await requireMember("approver")
  const db = createAdminClient()

  if (cuando === "motor") {
    const { data: p } = await db.from("cos_posts").select("render_qa, scheduled_at, window_start, schedule_source, schedule_lock, account_id, post_type, brand_id").eq("id", postId).single()
    if (!p?.render_qa) throw aviso("La pieza final todavía se está armando y revisando. Esperá unos segundos y recargá.")
    if (!p.scheduled_at || !p.window_start || p.schedule_lock || !["motor", "exploracion", "fijo"].includes(p.schedule_source ?? "")) {
      throw aviso("Este post no tiene horario de la agenda: elegí «Apenas apruebe» u «Otro horario».")
    }
    if (new Date(p.scheduled_at).getTime() <= Date.now() + 2 * 60_000) throw aviso("El horario de la agenda ya pasó: elegí otro.")
    // Se aprueba la hora que se vio: si la agenda la cambió mientras tanto, se avisa.
    if (!vistoAt || new Date(vistoAt).getTime() !== new Date(p.scheduled_at).getTime()) {
      throw aviso("La agenda acaba de cambiar el horario de este post: recargá la página para ver el nuevo antes de aprobar.")
    }
    // La hora de la agenda puede haber quedado vieja (otra pieza ya aprobada tomó ese lugar): se
    // verifica contra lo aprobado de la cuenta con las mismas reglas; si choca, la agenda recalcula.
    const ocupadosMotor = await ocupadosDeCuenta(db, p.account_id, postId, new Date(p.scheduled_at))
    const { data: marca } = await db.from("cos_brands").select("ritmo").eq("id", p.brand_id).single()
    const choque = chocaConReglas({ account: p.account_id, format: p.post_type as Formato }, new Date(p.scheduled_at), ocupadosMotor, leerRitmo(marca?.ritmo))
    if (choque) {
      await db.rpc("cos_enqueue_job", { p_type: "agenda:plan", p_payload: { brand_id: p.brand_id }, p_run_at: new Date(Date.now() - 3600_000).toISOString(), p_dedupe_key: `agenda:plan:${p.brand_id}:aprobar:${Math.floor(Date.now() / 60_000)}` })
      throw aviso(`Ese horario ya no sirve (${choque}): la agenda lo está recalculando. Recargá en un minuto y aprobá con la hora nueva.`)
    }
    await sellarYProgramar(db, postId, member.userId, p.scheduled_at)
    revalidatePath("/aprobaciones")
    revalidatePath("/inicio")
    return
  }

  const target = cuando ? new Date(cuando) : null
  if (target && Number.isNaN(target.getTime())) throw aviso("Fecha inválida")

  // Se aprueba lo que se vio: si la pieza final todavía se está armando o revisando, no se aprueba
  // (si no, se publicaría una versión que nadie miró).
  const { data: pieza } = await db.from("cos_posts").select("render_qa").eq("id", postId).single()
  if (!pieza?.render_qa) throw aviso("La pieza final todavía se está armando y revisando. Esperá unos segundos y recargá.")
  // "Ya" (o una fecha que está encima) se deja 2 min adelante para que el reloj no lo dé
  // por vencido mientras se aprueba; igual se encola ya mismo (abajo).
  const pedido = target && target.getTime() > Date.now() + 2 * 60_000 ? target : new Date(Date.now() + 2 * 60_000)
  // Freno anti-ráfaga: la misma cuenta no publica dos piezas más cerca de lo que pide la agenda.
  const { data: yo } = await db.from("cos_posts").select("account_id, post_type, cos_brands(ritmo)").eq("id", postId).single()
  const ritmo = leerRitmo((yo?.cos_brands as unknown as { ritmo: unknown } | null)?.ritmo)
  const ocupados = await ocupadosDeCuenta(db, yo?.account_id ?? "", postId, pedido)
  // Historia de una subida: si cae pegada a su reel/post de Instagram (misma cuenta y archivo), va 90 min después.
  let deseado = pedido
  if (yo?.post_type === "story") {
    const { data: m } = await db.from("cos_post_media").select("cos_asset_versions(asset_id)").eq("post_id", postId).order("position").limit(1).maybeSingle()
    const sub = (m as unknown as { cos_asset_versions: { asset_id: string } | null } | null)?.cos_asset_versions?.asset_id
    if (sub) {
      const { data: hermanos } = await db
        .from("cos_posts")
        .select("scheduled_at, cos_post_media!inner(cos_asset_versions!inner(asset_id))")
        .eq("account_id", yo.account_id)
        .in("post_type", ["reel", "feed", "carousel"])
        .in("status", ["APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "RETRY_SCHEDULED"])
        .eq("cos_post_media.cos_asset_versions.asset_id", sub)
      deseado = horaHistoriaManual(pedido, (hermanos ?? []).filter((h) => h.scheduled_at).map((h) => new Date(h.scheduled_at as string))).at
    }
  }
  // Respeta el máximo por día y el horario (9 a 22); una hora elegida puntualmente se respeta si no choca.
  const hueco = huecoConReglas({ account: yo?.account_id ?? "", format: (yo?.post_type ?? "feed") as Formato }, deseado, ocupados, { horaElegida: !!target && target.getTime() > Date.now() + 2 * 60_000, ritmo })
  const historiaCorrida = deseado.getTime() !== pedido.getTime()
  const publishNow = !hueco.corrido && !historiaCorrida && (!target || target.getTime() <= Date.now() + 2 * 60_000)
  const horaFinal = hueco.at
  // Hora elegida a mano: queda fijada (🔒) y sin ventana; la agenda no la mueve.
  const { error: fe } = await db
    .from("cos_posts")
    .update({
      scheduled_at: horaFinal.toISOString(),
      schedule_lock: true,
      schedule_source: "manual",
      window_start: null,
      window_end: null,
      schedule_reason: historiaCorrida && !hueco.corrido
        ? "La historia sale 90 min después de su reel o post, para no competir con él"
        : hueco.corrido
        ? `Se corrió a las ${horaFinal.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })} para no salir pegado a otra pieza de la cuenta`
        : publishNow
          ? "Apenas se aprobó"
          : "Horario elegido a mano",
    })
    .eq("id", postId)
    .eq("status", "PENDING_APPROVAL")
  if (fe) throw aviso(`No se pudo fijar el horario: ${fe.message}`)

  await sellarYProgramar(db, postId, member.userId)

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
  return { corrido: hueco.corrido || historiaCorrida, at: horaFinal.toISOString() }
}

/** PENDING_APPROVAL → APPROVED (la base sella el hash) → SCHEDULED (el worker lo publica en su hora). */
async function sellarYProgramar(db: ReturnType<typeof createAdminClient>, postId: string, userId: string, horaVista?: string) {
  let q = db
    .from("cos_posts")
    .update({ status: "APPROVED", approved_by: userId, approved_at: new Date().toISOString() })
    .eq("id", postId)
  // Con horario de la agenda: solo si sigue siendo el que se vio (la agenda corre en paralelo).
  if (horaVista) q = q.eq("scheduled_at", horaVista)
  const { data: ok, error: ae } = await q.select("id")
  if (ae) throw aviso(`No se pudo aprobar: ${ae.message}`)
  if (!ok?.length) throw aviso("La agenda acaba de cambiar el horario: recargá la página para verlo antes de aprobar.")
  const { error: se } = await db.from("cos_posts").update({ status: "SCHEDULED" }).eq("id", postId)
  if (se) throw aviso(`No se pudo programar: ${se.message}`)
}

// ── rechazar post ────────────────────────────────────────────────────────────

/**
 * Rechazar con motivo: los chips y la explicación quedan en el post y la IA los lee en cada texto
 * que escribe para la marca (shared/cos/rechazos.ts). Si el motivo es el material (la foto no sirve,
 * parece IA), ese archivo sale del Archivo y no se vuelve a proponer. `todos` rechaza también los
 * otros formatos pendientes de la misma subida.
 */
export async function rechazarPost(postId: string, motivos: string[] = [], nota = "", todos = false) {
  const member = await requireMember("approver")
  const problema = validarRechazo(motivos, nota)
  if (problema) throw aviso(problema)
  const db = createAdminClient()
  const { data: p } = await db.from("cos_posts").select("id, brand_id, cos_post_media(cos_asset_versions(asset_id))").eq("id", postId).single()
  if (!p) throw aviso("Ese post ya no existe")
  const assetId = (p as unknown as { cos_post_media: { cos_asset_versions: { asset_id: string } | null }[] }).cos_post_media?.[0]?.cos_asset_versions?.asset_id ?? null
  let ids = [postId]
  if (todos && assetId) {
    const { data: hermanos } = await db
      .from("cos_posts")
      .select("id, cos_post_media!inner(cos_asset_versions!inner(asset_id))")
      .eq("brand_id", p.brand_id)
      .eq("status", "PENDING_APPROVAL")
      .eq("cos_post_media.cos_asset_versions.asset_id", assetId)
    ids = [...new Set([postId, ...(hermanos ?? []).map((h) => h.id as string)])]
  }
  const { error } = await db
    .from("cos_posts")
    .update({
      status: "REJECTED",
      last_error: nota.trim() || "Rechazado desde Aprobaciones",
      reject_reasons: motivos,
      reject_note: nota.trim() || null,
      rejected_at: new Date().toISOString(),
      rejected_by: member.userId,
    })
    .in("id", ids)
  if (error) throw aviso(`No se pudo rechazar: ${error.message}`)
  if (assetId && motivos.some((m) => (MOTIVOS_DE_MATERIAL as string[]).includes(m))) {
    await db.from("cos_assets").update({ review_status: "discarded", status: "ARCHIVED" }).eq("id", assetId)
  }
  await db.from("cos_audit_log").insert({ event: "post:rechazado", entity_type: "post", entity_id: postId, actor: member.email ?? member.userId, details_json: { motivos, nota, posts: ids.length } })

  revalidatePath("/aprobaciones")
  revalidatePath("/inicio")
  return { rechazados: ids.length }
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
    // Vuelve sin horario ni candado: se elige de nuevo al aprobar (o lo ubica la agenda).
    .update({ status: "PENDING_APPROVAL", scheduled_at: null, window_start: null, window_end: null, schedule_lock: false, schedule_source: null, schedule_reason: null })
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

// ── partes de un video que no se usan (06-10-2026) ───────────────────────────

/**
 * Guarda los tramos de un video que Javier no quiere que el motor use. Quedan en la versión del
 * archivo: todos los reels que salgan de ese video los evitan (shared/cos/reel.ts → ventanaLibre).
 */
export async function guardarPartesExcluidas(versionId: string, tramos: [number, number][]) {
  await requireMember("editor")
  if (!/^[0-9a-f-]{36}$/.test(versionId)) throw aviso("Video inválido")
  const excluir = normalizarExcluidos(tramos)
  const { error } = await createAdminClient().from("cos_asset_versions").update({ excluir }).eq("id", versionId)
  if (error) throw aviso(`No se pudo guardar: ${error.message}`)
  return { tramos: excluir.length }
}

// ── plantillas propias por marca (06-10-2026) ───────────────────────────────

/**
 * Cambia la plantilla de una pieza (o la tapa de un reel). `plantillaId` = una de la marca, o
 * "clasica" para volver al texto encima de la foto. La IA reescribe los textos para esa plantilla.
 */
export async function cambiarPlantilla(postId: string, plantillaId: string) {
  const member = await requireMember("editor")
  const db = createAdminClient()
  const { data: p, error } = await db.from("cos_posts").select("id, status, post_type, montaje, cos_brands(slug, plantillas)").eq("id", postId).single()
  if (error || !p) throw aviso("No encuentro esa publicación")
  if (p.status !== "PENDING_APPROVAL") throw aviso("Esta publicación ya no espera aprobación")
  const marca = p.cos_brands as unknown as { slug: string; plantillas: string[] | null } | null
  if (plantillaId !== "clasica") {
    const pl = plantilla(plantillaId)
    if (!pl || pl.marca !== marca?.slug || !(marca.plantillas ?? []).includes(pl.id)) throw aviso("Esa plantilla no es de esta marca")
    if (pl.formato !== (p.post_type === "story" ? "story" : "feed")) throw aviso("Esa plantilla no es para este formato")
  }
  // Mientras se rearma, la pieza vieja no se muestra (no se aprueba algo que ya no es).
  const limpiar = p.montaje ? { tapa_key: null } : { render_key: null, render_qa: null }
  const { error: ue } = await db.from("cos_posts").update(limpiar).eq("id", postId)
  if (ue) throw aviso(`No se pudo cambiar: ${ue.message}`)
  const { error: je } = await db.rpc("cos_enqueue_job", {
    p_type: "post:disenar",
    p_payload: { post_id: postId, plantilla: plantillaId, by: member.email ?? member.userId },
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
 * «Usar» de varias juntas (Biblioteca): las marcadas que ya están analizadas pasan a elegidas y
 * cada una arma sus borradores. Las que tienen caras quedan afuera (piden permiso una por una) y
 * las que todavía se analizan se avisan para usarlas después.
 */
export async function usarVarios(assetIds: string[]) {
  await requireMember("editor")
  const ids = [...new Set(assetIds)].filter((id) => UUID.test(id))
  if (!ids.length) throw aviso("No hay nada seleccionado")
  if (ids.length > 60) throw aviso("Son muchas de una vez: usá hasta 60 (cada una arma su reel y sus posts)")
  const db = createAdminClient()
  const { data: todas, error: le } = await db.from("cos_assets").select("id, consent, status, review_status").in("id", ids)
  if (le) throw aviso(`No se pudieron leer: ${le.message}`)
  const bloqueadas = (todas ?? []).filter((a) => a.consent === "blocked").length
  const listas = (todas ?? []).filter((a) => a.consent !== "blocked" && ["READY", "IN_USE"].includes(a.status) && ["pending", "approved"].includes(a.review_status)).map((a) => a.id)
  const analizando = ids.length - bloqueadas - listas.length
  if (listas.length) {
    const { error } = await db.from("cos_assets").update({ review_status: "approved" }).in("id", listas)
    if (error) throw aviso(`No se pudieron marcar: ${error.message}`)
    for (const id of listas) {
      const { error: je } = await db.rpc("cos_enqueue_job", { p_type: "post:draft", p_payload: { asset_id: id }, p_dedupe_key: `draft:${id}` })
      if (je) throw aviso(`No se pudieron pedir los borradores: ${je.message}`)
    }
  }
  revalidatePath("/media")
  return { usadas: listas.length, bloqueadas, analizando }
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

// ── Armar reel con varias piezas (F9 etapa 2) ────────────────────────────────

/**
 * Varias piezas elegidas (2 a 8, misma marca, analizadas, sin bloqueo por caras, videos de hasta
 * 48 MB) → el worker arma UN reel con todas (reel:build) y deja los borradores en Aprobaciones.
 * El orden de la selección es el orden de las fuentes.
 */
export async function armarReelConVarias(assetIds: string[]) {
  await requireMember("editor")
  const ids = [...new Set(assetIds)].filter((id) => UUID.test(id))
  if (ids.length < 2) throw aviso("Elegí al menos 2 piezas (con una sola, usá «Usar»)")
  if (ids.length > 8) throw aviso("Un reel lleva hasta 8 piezas")
  const db = createAdminClient()
  const { data, error } = await db.from("cos_assets").select("id, brand_id, status, consent, size_bytes, review_status, quality_score").in("id", ids)
  if (error) throw aviso(`No se pudo armar: ${error.message}`)
  if ((data ?? []).length !== ids.length) throw aviso("Alguna pieza ya no existe: recargá la página")
  if (new Set(data!.map((a) => a.brand_id)).size > 1) throw aviso("Las piezas tienen que ser de la misma marca")
  if (data!.some((a) => !["READY", "IN_USE"].includes(a.status) || a.quality_score == null)) throw aviso("Alguna pieza todavía se está analizando: probá en un rato")
  if (data!.some((a) => a.consent === "blocked")) throw aviso("Alguna pieza tiene caras sin permiso: confirmá el permiso o sacala de la selección")
  if (data!.some((a) => (a.size_bytes ?? 0) > 48 * 1024 * 1024)) throw aviso("Algún video pesa más de 48 MB: sacalo de la selección")
  // Lo del archivo queda como "usado" (igual que con «Usar»).
  await db.from("cos_assets").update({ review_status: "approved" }).in("id", ids).eq("review_status", "pending")
  const buildId = crypto.randomUUID()
  const { error: je } = await db.rpc("cos_enqueue_job", {
    p_type: "reel:build",
    p_payload: { build_id: buildId, asset_ids: ids },
    p_dedupe_key: `reel:build:${buildId}`,
  })
  if (je) throw aviso(`No se pudo pedir el reel: ${je.message}`)
  revalidatePath("/media")
  return { piezas: ids.length }
}

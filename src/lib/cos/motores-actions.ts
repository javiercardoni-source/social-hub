"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { aviso } from "@/lib/aviso"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { KINDS, extDe, validarArchivo, type KindMotor } from "../../../shared/cos/motores"
import { esRutaDeMusica, normalizarEtiquetas, tituloTema } from "../../../shared/cos/gustos"
import { PARAS, paraPorDefecto, type Para } from "../../../shared/cos/estilo"
import { tipoDeLink } from "../../../shared/cos/referencia-link"

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

export async function registrarMotor(input: { kind: KindMotor; key: string; name: string; size: number; note?: string; para?: Para }) {
  const { member, brand, db } = await marcaActiva()
  if (!KINDS.includes(input.kind)) throw aviso("Tipo inválido")
  // La key la generó prepararSubidaMotor para esta marca y este tipo.
  if (!input.key.startsWith(`${carpeta(input.kind, brand.slug)}/`) || input.key.includes("..")) throw aviso("Subida inválida")

  if (input.kind === "musica") {
    // Ficha del tema (F7): se registra ya y el worker mide duración, BPM y energía.
    if (!esRutaDeMusica(input.key, brand.slug)) throw aviso("Subida inválida")
    const { data: t, error } = await db
      .from("cos_music_tracks")
      .upsert({ brand_id: brand.id, storage_key: input.key, title: tituloTema(input.name), active: true, analyzed_at: null, analysis_error: null }, { onConflict: "storage_key" })
      .select("id")
      .single()
    if (error || !t) throw aviso(`El tema se subió pero no se pudo registrar: ${error?.message}`)
    await db.rpc("cos_enqueue_job", { p_type: "music:analyze", p_payload: { track_id: t.id }, p_run_at: new Date().toISOString(), p_dedupe_key: `music:analyze:${t.id}` })
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
      // Referencias: el formato que eligió en la pantalla (o el que sale del archivo).
      para: input.kind === "referencia" ? (input.para && PARAS.includes(input.para) ? input.para : paraPorDefecto(mime)) : null,
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
  // La ficha queda (los posts que lo usaron siguen enseñando al motor): solo sale de la biblioteca.
  await db.from("cos_music_tracks").update({ active: false }).eq("storage_key", key)
  revalidatePath("/marca")
}

/** Chips de la ficha de un tema (género, mood, voz). Vocabulario cerrado: lo demás se descarta. */
export async function etiquetarTema(trackId: string, etiquetas: { genre: string | null; mood: string[]; vocals: boolean | null }) {
  const { brand, db } = await marcaActiva()
  const e = normalizarEtiquetas(etiquetas)
  const { data, error } = await db
    .from("cos_music_tracks")
    .update({ genre: e.genre, mood: e.mood, vocals: e.vocals })
    .eq("id", trackId)
    .eq("brand_id", brand.id)
    .select("id")
  if (error) throw aviso(`No se pudo guardar: ${error.message}`)
  if (!data?.length) throw aviso("Ese tema no es de esta marca")
  revalidatePath("/marca")
  return e
}

/** Cambia el formato de una referencia (post, reel o historia) y la vuelve a analizar con ese foco. */
export async function cambiarParaReferencia(id: string, para: Para) {
  const { brand, db } = await marcaActiva()
  if (!PARAS.includes(para)) throw aviso("Formato inválido")
  const { data, error } = await db
    .from("cos_brand_assets")
    .update({ para, status: "analizando", error: null })
    .eq("id", id)
    .eq("brand_id", brand.id)
    .eq("kind", "referencia")
    .select("id")
  if (error) throw aviso(`No se pudo cambiar: ${error.message}`)
  if (!data?.length) throw aviso("Esa referencia no es de esta marca")
  await db.rpc("cos_enqueue_job", { p_type: "ref:analyze", p_payload: { ref_id: id }, p_run_at: new Date().toISOString(), p_dedupe_key: `ref:${id}:${para}` })
  revalidatePath("/marca")
}

/**
 * Referencia pegando un link (CapCut, o cualquier página con video). El worker baja el video, toma
 * la duración exacta de cada toma si es una plantilla de CapCut, lo mide y arma la ficha.
 */
export async function agregarReferenciaPorLink(input: { url: string; para: Para; note?: string }) {
  const { member, brand, db } = await marcaActiva()
  const url = input.url.trim()
  const tipo = tipoDeLink(url)
  if (!tipo) throw aviso("Pegá un link completo que empiece con https://")
  if (!PARAS.includes(input.para)) throw aviso("Formato inválido")
  const { data: ya } = await db.from("cos_brand_assets").select("id").eq("brand_id", brand.id).eq("kind", "referencia").eq("source_url", url).maybeSingle()
  if (ya) throw aviso("Ese link ya está en las referencias de la marca")
  const key = `${carpeta("referencia", brand.slug)}/${randomUUID()}.mp4`
  const nombre = tipo === "capcut" ? `Plantilla de CapCut ${url.match(/templates\/(\d+)/)?.[1] ?? ""}`.trim() : `Link de ${tipo === "otro" ? new URL(url).hostname : tipo}`
  const { data: row, error } = await db
    .from("cos_brand_assets")
    .insert({
      brand_id: brand.id,
      kind: "referencia",
      name: nombre.slice(0, 200),
      storage_key: key,
      mime: "video/mp4",
      note: input.note?.trim().slice(0, 500) || null,
      para: input.para,
      source_url: url,
      status: "analizando",
      created_by: member.userId,
    })
    .select("id")
    .single()
  if (error || !row) throw aviso(`No se pudo guardar: ${error?.message}`)
  await db.rpc("cos_enqueue_job", { p_type: "ref:link", p_payload: { ref_id: row.id }, p_run_at: new Date().toISOString(), p_dedupe_key: `ref:link:${row.id}` })
  revalidatePath("/marca")
  return { tipo }
}

/** Rehace ya la recomendación de qué música buscar (sale de las referencias de Reels). */
export async function pedirMusicaRecomendada() {
  const { brand, db } = await marcaActiva()
  await db.rpc("cos_enqueue_job", { p_type: "musica:recomendar", p_payload: { brand_id: brand.id }, p_run_at: new Date().toISOString(), p_dedupe_key: `musica:recomendar:${brand.id}:ya` })
  revalidatePath("/marca")
}

/** Palabra por corte (estilo karaoke) en los reels de la marca: prender o apagar. */
export async function cambiarKaraoke(activo: boolean) {
  const { brand, db } = await marcaActiva()
  const { error } = await db.from("cos_brands").update({ reel_karaoke: activo }).eq("id", brand.id)
  if (error) throw aviso(`No se pudo guardar: ${error.message}`)
  revalidatePath("/marca")
}

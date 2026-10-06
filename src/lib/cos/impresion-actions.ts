"use server"

import { revalidatePath } from "next/cache"
import { aviso } from "@/lib/aviso"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { dpiPara, validarFormato } from "../../../shared/cos/impresion"
import { normalizarCampos, plantillasImpresion } from "../../../shared/cos/plantillas"

/**
 * Diseño gráfico (imprenta): los formatos los carga Javier (sirven para todas las marcas) y cada
 * pieza la arma el worker (impresion:render) con la plantilla y la paleta de la marca activa.
 */

const UUID = /^[0-9a-f-]{36}$/

export async function crearFormato(input: { nombre: string; ancho_cm: number; alto_cm: number; sangrado_mm?: number }) {
  await requireMember("editor")
  const f = validarFormato(input)
  if (typeof f === "string") throw aviso(f)
  const { error } = await createAdminClient()
    .from("cos_print_formats")
    .insert({ ...f, dpi: dpiPara(f.ancho_mm, f.alto_mm) })
  if (error) throw aviso(`No se pudo guardar: ${error.message}`)
  revalidatePath("/diseno")
}

export async function borrarFormato(id: string) {
  await requireMember("editor")
  if (!UUID.test(id)) throw aviso("Formato inválido")
  const db = createAdminClient()
  const { count } = await db.from("cos_print_pieces").select("id", { count: "exact", head: true }).eq("format_id", id)
  if (count) throw aviso(`Tiene ${count} pieza${count > 1 ? "s" : ""} armada${count > 1 ? "s" : ""}: borralas primero`)
  const { error } = await db.from("cos_print_formats").delete().eq("id", id)
  if (error) throw aviso(`No se pudo borrar: ${error.message}`)
  revalidatePath("/diseno")
}

export async function crearPieza(input: { formatId: string; plantilla: string; campos: Record<string, string>; versionId: string | null }) {
  const member = await requireMember("editor")
  const brand = await getActiveBrand()
  if (!brand) throw aviso("Elegí una marca arriba a la izquierda")
  if (!UUID.test(input.formatId)) throw aviso("Elegí un formato")
  if (input.versionId && !UUID.test(input.versionId)) throw aviso("Foto inválida")
  const db = createAdminClient()
  const { data: b } = await db.from("cos_brands").select("plantillas").eq("id", brand.id).single()
  const p = plantillasImpresion(brand.slug, (b?.plantillas ?? []) as string[]).find((x) => x.id === input.plantilla)
  if (!p) throw aviso("Esa plantilla no es de esta marca")
  if (p.fotos && !input.versionId) throw aviso("Elegí una foto")
  const campos = normalizarCampos(p, input.campos)
  const falta = p.campos.find((c) => !c.opcional && !campos[c.clave])
  if (falta) throw aviso(`Falta completar: ${falta.ayuda}`)
  const { data: row, error } = await db
    .from("cos_print_pieces")
    .insert({ brand_id: brand.id, format_id: input.formatId, plantilla: p.id, campos, version_id: input.versionId, created_by: member.userId })
    .select("id")
    .single()
  if (error || !row) throw aviso(`No se pudo guardar: ${error?.message}`)
  // Va adelante en la cola (la cola sale por run_at): una pieza de imprenta tarda segundos y Javier
  // la está esperando en pantalla; no tiene sentido que espere detrás de una tanda de reels.
  const { error: je } = await db.rpc("cos_enqueue_job", {
    p_type: "impresion:render",
    p_payload: { pieza_id: row.id },
    p_run_at: new Date(Date.now() - 24 * 3600_000).toISOString(),
    p_dedupe_key: `impresion:${row.id}`,
  })
  if (je) throw aviso(`No se pudo pedir la pieza: ${je.message}`)
  revalidatePath("/diseno")
}

export async function borrarPieza(id: string) {
  await requireMember("editor")
  if (!UUID.test(id)) throw aviso("Pieza inválida")
  const db = createAdminClient()
  const { data } = await db.from("cos_print_pieces").select("archivo_key").eq("id", id).maybeSingle()
  if (data?.archivo_key) await db.storage.from("cos-media").remove([data.archivo_key])
  const { error } = await db.from("cos_print_pieces").delete().eq("id", id)
  if (error) throw aviso(`No se pudo borrar: ${error.message}`)
  revalidatePath("/diseno")
}

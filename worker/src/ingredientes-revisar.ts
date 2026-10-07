/**
 * ingredientes:revisar — corre cada hora (worker/src/main.ts). Las piezas escritas antes del control
 * de ingredientes (07-10-2026) siguen pendientes con su texto: acá se controlan SIN regenerarlas
 * (Javier: "dale, hazlo"). Por cada archivo se miran los ingredientes una sola vez (quedan en
 * ai_json); los textos de sus piezas se cotejan con el vocabulario cerrado y, si nombran algo que
 * no se ve, queda el aviso para quien aprueba. `avisos_at` marca la pieza como controlada: cada
 * corrida toma las que todavía no pasaron, hasta MAX_ARCHIVOS archivos, para no frenar los renders.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Handler } from "./handlers.ts"
import { PermanentError } from "./queue.ts"
import { storageFor, supabaseStorage } from "./storage.ts"
import { framesForAi, probe, withTmp, writeTmp } from "./media.ts"
import { controlarIngredientes } from "./ai.ts"
import { asegurarIngredientes } from "./ingredientes.ts"
import { avisoIngrediente, leerIngredientes, textosDePieza } from "../../shared/cos/ingredientes.ts"
import { normalizarDatos } from "../../shared/cos/datos-vigentes.ts"

const MAX_ARCHIVOS = 60
const MAX_PIEZAS = 400

type Version = {
  id: string
  storage_driver: string
  storage_key: string | null
  drive_file_id: string | null
  mime: string | null
  cos_assets: { id: string; description: string | null; description_by_ai: boolean | null; ai_json: unknown } | null
}
type Pieza = {
  id: string
  caption: string
  hashtags: string
  overlay_text: string
  montaje: unknown
  diseno: unknown
  cos_brands: { slug: string; datos_vigentes: unknown } | null
  cos_post_media: { position: number; cos_asset_versions: Version | null }[]
}

/** Cuadros para la IA: la foto a 1568 px, o 4 fotogramas del video (lo mismo que ve el clasificador). */
async function cuadros(db: SupabaseClient, v: Version): Promise<Buffer[]> {
  const data =
    v.storage_driver === "supabase" && v.storage_key
      ? await supabaseStorage(db).download(v.storage_key)
      : await storageFor("drive", db).download(v.drive_file_id ?? v.storage_key ?? "")
  return withTmp(async (dir) => {
    const f = await writeTmp(dir, "src", data)
    return framesForAi(f, await probe(f, v.mime), dir)
  })
}

const revisarIngredientes: Handler = async (_job, { db, log }) => {
  const { data: s } = await db.from("cos_settings").select("ai_model").eq("id", true).single()
  if (!s?.ai_model) throw new PermanentError("sin ai_model en cos_settings")
  const { data, error } = await db
    .from("cos_posts")
    .select(
      `id, caption, hashtags, overlay_text, montaje, diseno, cos_brands(slug, datos_vigentes),
       cos_post_media(position, cos_asset_versions(id, storage_driver, storage_key, drive_file_id, mime, cos_assets!cos_asset_versions_asset_id_fkey(id, description, description_by_ai, ai_json)))`,
    )
    .eq("status", "PENDING_APPROVAL")
    .is("avisos_at", null)
    .order("created_at")
    .limit(MAX_PIEZAS)
  if (error) throw new Error(`posts: ${error.message}`)
  const piezas = (data ?? []) as unknown as Pieza[]
  if (!piezas.length) return

  // Agrupadas por archivo (el primero de la pieza): una mirada por archivo, no por pieza.
  const porArchivo = new Map<string, { v: Version; piezas: Pieza[] }>()
  const sinArchivo: Pieza[] = []
  for (const p of piezas) {
    const v = [...p.cos_post_media].sort((a, b) => a.position - b.position)[0]?.cos_asset_versions
    if (!v?.cos_assets) {
      sinArchivo.push(p)
      continue
    }
    const g = porArchivo.get(v.cos_assets.id) ?? { v, piezas: [] }
    g.piezas.push(p)
    porArchivo.set(v.cos_assets.id, g)
  }

  const ahora = new Date().toISOString()
  let mirados = 0
  let revisadas = 0
  let conAviso = 0
  let sinMirar = 0
  for (const [assetId, g] of [...porArchivo].slice(0, MAX_ARCHIVOS)) {
    const a = g.v.cos_assets!
    const porIA = !!a.description_by_ai
    const yaTenia = !!leerIngredientes(a.ai_json)
    const ingredientes = await asegurarIngredientes(db, {
      model: s.ai_model,
      assetId,
      aiJson: a.ai_json,
      frames: () => cuadros(db, g.v),
      dicho: porIA ? null : a.description,
      provisoria: porIA,
      log,
    })
    // Si no se pudo mirar, no se marca nada: la próxima corrida lo vuelve a intentar (un aviso
    // "nombra arroz y no se ve" porque falló la mirada sería mentira).
    if (!ingredientes) {
      sinMirar++
      continue
    }
    if (!yaTenia) mirados++
    for (const p of g.piezas) {
      const combos = normalizarDatos(p.cos_brands?.datos_vigentes)
        .combos.filter((c) => c.activo)
        .map((c) => c.nombre)
      const malos = controlarIngredientes(textosDePieza(p, p.cos_brands?.slug ?? ""), { ingredientes, dichoPorPersona: porIA ? null : a.description, combos })
      const { error: e } = await db
        .from("cos_posts")
        .update({ avisos: malos.map(avisoIngrediente), avisos_at: ahora })
        .eq("id", p.id)
        .eq("status", "PENDING_APPROVAL")
      if (e) {
        log("no se pudo guardar el control de ingredientes", { post: p.id, error: e.message })
        continue
      }
      revisadas++
      if (malos.length) conAviso++
    }
  }
  // Sin archivo no hay nada que cotejar: quedan marcadas para no volver a mirarlas.
  for (const p of sinArchivo) await db.from("cos_posts").update({ avisos_at: ahora }).eq("id", p.id).eq("status", "PENDING_APPROVAL")

  log("ingredientes revisados", {
    archivos: Math.min(porArchivo.size, MAX_ARCHIVOS),
    mirados,
    sinMirar,
    piezas: revisadas,
    conAviso,
    quedan: Math.max(0, porArchivo.size - MAX_ARCHIVOS) + (piezas.length >= MAX_PIEZAS ? 1 : 0),
  })
}

export const ingredientesRevisarHandlers: Record<string, Handler> = { "ingredientes:revisar": revisarIngredientes }

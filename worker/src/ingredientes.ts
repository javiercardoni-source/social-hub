/**
 * Listas de ingredientes de un asset (07-10-2026). Lo clasificado antes no las tiene: se miran una
 * vez con el modelo completo y quedan guardadas en `ai_json` para la próxima. `frames` se pide
 * recién si hace falta (bajar el archivo cuesta). Si no se puede, null: los textos no nombran
 * ningún ingrediente, que es lo seguro.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { leerIngredientes, type Ingredientes } from "../../shared/cos/ingredientes.ts"
import { verIngredientes } from "./ai.ts"

export async function asegurarIngredientes(
  db: SupabaseClient,
  o: {
    model: string
    assetId: string
    aiJson: unknown
    frames: () => Promise<Buffer[]>
    /** Lo que dijo el empleado (null si la descripción la escribió la IA). */
    dicho?: string | null
    /** La descripción no la escribió una persona. */
    provisoria?: boolean
    log: (msg: string, extra?: Record<string, unknown>) => void
  },
): Promise<Ingredientes | null> {
  const ya = leerIngredientes(o.aiJson)
  if (ya) return ya
  try {
    const frames = (await o.frames()).slice(0, 4)
    if (!frames.length) return null
    const vistos = await verIngredientes({ db, model: o.model, frames, dicho: o.dicho, provisoria: o.provisoria, assetId: o.assetId })
    const base = o.aiJson && typeof o.aiJson === "object" ? (o.aiJson as Record<string, unknown>) : {}
    const { error } = await db
      .from("cos_assets")
      .update({ ai_json: { ...base, ingredientes_visibles: vistos.visibles, ingredientes_dudosos: vistos.dudosos } })
      .eq("id", o.assetId)
    if (error) o.log("no se pudieron guardar los ingredientes", { asset: o.assetId, error: error.message })
    o.log("ingredientes mirados", { asset: o.assetId, visibles: vistos.visibles, dudosos: vistos.dudosos })
    return vistos
  } catch (e) {
    o.log("no se pudieron mirar los ingredientes: los textos no nombran ninguno", { asset: o.assetId, error: String(e).slice(0, 200) })
    return null
  }
}

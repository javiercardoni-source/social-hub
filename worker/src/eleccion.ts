/**
 * F7 · Motor de gustos (M2) en el worker: arma los candidatos con lo aprendido (cos_taste_models)
 * y elige con shared/cos/pick.ts. Reemplaza los Math.random() de la música.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { elegir, incertidumbrePorN, ordenar, porqueMusica, type Candidato, type Eleccion } from "../../shared/cos/pick.ts"
import { normalizarRasgos, RASGO_CAMPOS } from "../../shared/cos/gustos.ts"
import type { EfectoRasgo } from "../../shared/cos/taste.ts"

type ModeloGustos = {
  computed_at: string
  model_json: {
    efectos: EfectoRasgo[]
    temas: { track_id: string; efecto: number; n: number }[]
    backtest: { gana: boolean } | null
  }
}

/** Última foto del modelo "gusta" de la marca para ese formato (las historias usan el de reels si no hay). */
async function modelo(db: SupabaseClient, brandId: string, format: string): Promise<ModeloGustos | null> {
  for (const f of format === "story" ? ["story", "reel"] : format === "carousel" ? ["carousel", "feed"] : [format]) {
    const { data } = await db.from("cos_taste_models").select("computed_at, model_json").eq("brand_id", brandId).eq("format", f).eq("objective", "gusta").order("computed_at", { ascending: false }).limit(1)
    if (data?.length) return data[0] as unknown as ModeloGustos
  }
  return null
}

/** Temas activos de la marca con su efecto aprendido (o heredado) y cuánto se usaron hace poco. */
export async function candidatosMusica(db: SupabaseClient, brandId: string, format: string, disponibles: string[]): Promise<{ candidatos: Candidato[]; modelo: string | null }> {
  const [{ data: temas }, m, { data: recientes }] = await Promise.all([
    db.from("cos_music_tracks").select("id, storage_key, title").eq("brand_id", brandId).eq("active", true),
    modelo(db, brandId, format),
    db.from("cos_posts").select("music_track_id").eq("brand_id", brandId).not("music_track_id", "is", null).order("created_at", { ascending: false }).limit(10),
  ])
  const usos = new Map<string, number>()
  for (const r of recientes ?? []) usos.set(r.music_track_id as string, (usos.get(r.music_track_id as string) ?? 0) + 1)
  const ok = new Set(disponibles)
  const candidatos = (temas ?? [])
    .filter((t) => ok.has(t.storage_key))
    .map((t) => {
      const e = m?.model_json.temas.find((x) => x.track_id === t.id)
      return { id: t.storage_key as string, titulo: t.title as string, efecto: e?.efecto ?? 1, incertidumbre: incertidumbrePorN(e?.n ?? 0), usosRecientes: usos.get(t.id as string) ?? 0, n: e?.n ?? 0 }
    })
  // Un archivo de la biblioteca todavía sin ficha también es candidato (neutral), para no perderlo.
  for (const k of disponibles) if (!candidatos.some((c) => c.id === k)) candidatos.push({ id: k, titulo: k.split("/").pop()!.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), efecto: 1, incertidumbre: incertidumbrePorN(0), usosRecientes: 0, n: 0 })
  return { candidatos, modelo: m?.computed_at ?? null }
}

/**
 * Elige la música de una pieza. `campania` = feriado, clima o fecha especial: sin exploración.
 * Devuelve la clave del tema y el porqué (pick_json), o null si la marca no tiene música.
 */
export async function elegirMusica(
  db: SupabaseClient,
  o: { brandId: string; format: string; disponibles: string[]; semilla: string; campania?: boolean; excluir?: string[] },
): Promise<{ key: string; pick: Eleccion & { porque: string } } | null> {
  const { candidatos, modelo: version } = await candidatosMusica(db, o.brandId, o.format, o.disponibles)
  const e = elegir(candidatos, { semilla: o.semilla, exploracion: o.campania ? 0 : undefined, excluir: o.excluir, modelo: version ?? undefined })
  if (!e) return null
  const n = candidatos.find((c) => c.id === e.elegido)?.n ?? 0
  return { key: e.elegido, pick: { ...e, porque: porqueMusica(e, n) } }
}

/** Los 3 temas que el motor propone para un reel (el elegido primero): la IA del guion elige entre ellos. */
export async function temasParaReel(db: SupabaseClient, o: { brandId: string; disponibles: string[]; semilla: string; excluir?: string[] }): Promise<{ keys: string[]; pick: (Eleccion & { porque: string }) | null }> {
  const { candidatos, modelo: version } = await candidatosMusica(db, o.brandId, "reel", o.disponibles)
  const e = elegir(candidatos, { semilla: o.semilla, excluir: o.excluir, modelo: version ?? undefined })
  if (!e) return { keys: [], pick: null }
  const n = candidatos.find((c) => c.id === e.elegido)?.n ?? 0
  const resto = ordenar(candidatos.filter((c) => c.id !== e.elegido && !(o.excluir ?? []).includes(c.id))).slice(0, 2).map((c) => c.id)
  return { keys: [e.elegido, ...resto], pick: { ...e, porque: porqueMusica(e, n) } }
}

/**
 * Imagen: el motor solo elige donde el backtest mostró que predice mejor que "lo de siempre"
 * (spec F7: si no, no elige imágenes). Devuelve null si no está habilitado: queda la regla de siempre.
 */
export async function elegirImagen(
  db: SupabaseClient,
  o: { brandId: string; format: string; fotos: { version: string; traits: unknown; quality: number | null }[]; semilla: string; campania?: boolean },
): Promise<{ version: string; pick: Eleccion } | null> {
  const m = await modelo(db, o.brandId, o.format)
  if (!m?.model_json.backtest?.gana || !o.fotos.length) return null
  const claros = m.model_json.efectos.filter((e) => e.claro)
  const candidatos: Candidato[] = o.fotos.map((f) => {
    const t = normalizarRasgos(f.traits)
    let log = 0
    for (const c of RASGO_CAMPOS) {
      const e = claros.find((x) => x.campo === c && x.valor === t[c])
      if (e) log += Math.log(e.efecto)
    }
    return { id: f.version, titulo: f.version, efecto: Math.exp(log), incertidumbre: 0.15, usosRecientes: 0, n: 10 }
  })
  const e = elegir(candidatos, { semilla: o.semilla, exploracion: o.campania ? 0 : undefined, modelo: m.computed_at })
  return e ? { version: e.elegido, pick: e } : null
}

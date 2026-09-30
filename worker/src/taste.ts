/**
 * F7 · Motor de gustos M1 — taste:learn (diario): aprende qué rasgos le gustan al público de cada
 * marca y guarda una foto del modelo por marca × formato × objetivo en cos_taste_models.
 * El cálculo está en shared/cos/taste.ts (puro, con tests). Solo lectura del resto de la base.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Handler } from "./handlers.ts"
import { backtest, efectoTema, efectosRasgos, liftsPorMetrica, puntaje, rasgosDeTema, ridge, OBJETIVOS, type Objetivo, type PostGusto } from "../../shared/cos/taste.ts"
import { modeloAgenda, type PostCtx } from "../../shared/cos/agenda.ts"
import { arSlot, type Format } from "../../shared/cos/timing.ts"
import { normalizarRasgos, RASGO_CAMPOS } from "../../shared/cos/gustos.ts"

type Media = {
  id: string
  account_id: string
  brand_id: string
  format: Format
  posted_at: string
  metrics: Record<string, number>
  traits: unknown
  contexto: { clima?: string | null; feriado?: boolean } | null
  post_id: string | null
  pautado: boolean
}

async function todo<T>(q: (from: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

/** Métricas a 48 h (edad fija, comparable) si hay una foto cerca; si no, el último valor. */
async function metricasA48h(db: SupabaseClient, ids: string[]): Promise<Map<string, Record<string, number>>> {
  const out = new Map<string, Record<string, number>>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("cos_media_metrics").select("media_id, age_hours, data").in("media_id", ids.slice(i, i + 200)).gte("age_hours", 24).lte("age_hours", 96)
    const mejor = new Map<string, { d: number; data: Record<string, number> }>()
    for (const r of data ?? []) {
      const d = Math.abs(Number(r.age_hours) - 48)
      const prev = mejor.get(r.media_id)
      if (!prev || d < prev.d) mejor.set(r.media_id, { d, data: r.data })
    }
    for (const [k, v] of mejor) out.set(k, v.data)
  }
  return out
}

const aprenderGustos: Handler = async (_job, { db, log }) => {
  const media = await todo<Media>((from) =>
    db.from("cos_media").select("id, account_id, brand_id, format, posted_at, metrics, traits, contexto, post_id, pautado").gte("posted_at", new Date(Date.now() - 3 * 365 * 86_400_000).toISOString()).order("posted_at").range(from, from + 999),
  )
  // Lo de Content OS: plantilla, música (con su ficha) y si se borró. Lo simulado nunca llega a cos_media.
  const posts = await todo<{ id: string; template: string; overlay_text: string; music_track_id: string | null; deleted_at: string | null; simulated: boolean }>((from) =>
    db.from("cos_posts").select("id, template, overlay_text, music_track_id, deleted_at, simulated").not("remote_post_id", "is", null).range(from, from + 999),
  )
  const postDe = new Map(posts.map((p) => [p.id, p]))
  const { data: temas } = await db.from("cos_music_tracks").select("id, brand_id, title, genre, mood, vocals, bpm, energy, active, storage_key")
  // Cambios de música de Javier en Aprobaciones (F7 M2): preferencia de marca. +1 al que eligió él,
  // −1 al que había elegido el motor. Se aplica como un pequeño empujón (±3 % por vez, tope ±15 %).
  const { data: overrides } = await db.from("cos_posts").select("pick_json").not("pick_json->override", "is", null)
  const preferencia = new Map<string, number>()
  for (const o of overrides ?? []) {
    const ov = (o.pick_json as { override?: { motor?: string | null; javier?: string | null } }).override
    if (ov?.javier) preferencia.set(ov.javier, (preferencia.get(ov.javier) ?? 0) + 1)
    if (ov?.motor) preferencia.set(ov.motor, (preferencia.get(ov.motor) ?? 0) - 1)
  }
  const empujon = (key: string) => Math.max(0.85, Math.min(1.15, 1.03 ** (preferencia.get(key) ?? 0)))
  const temaDe = new Map((temas ?? []).map((t) => [t.id as string, t]))
  const a48 = await metricasA48h(db, media.filter((m) => Date.now() - Date.parse(m.posted_at) < 120 * 86_400_000).map((m) => m.id))

  const { data: marcas } = await db.from("cos_brands").select("id, slug").eq("active", true)
  let fotos = 0
  for (const b of marcas ?? []) {
    // No enseñan: lo pautado, lo borrado y lo simulado (esto último nunca llega a cos_media; por las dudas).
    const propias = media.filter((m) => m.brand_id === b.id && !m.pautado && !(m.post_id && (postDe.get(m.post_id)?.deleted_at || postDe.get(m.post_id)?.simulated)))
    for (const format of [...new Set(propias.map((m) => m.format))] as Format[]) {
      const grupo = propias.filter((m) => m.format === format)
      if (grupo.length < 20) continue
      // Franja de cada post según el motor de horarios de su cuenta (se descuenta del alcance).
      const franjaDe = new Map<string, number>()
      for (const acc of [...new Set(grupo.map((m) => m.account_id))]) {
        const deLaCuenta = grupo.filter((m) => m.account_id === acc)
        const perf: PostCtx[] = deLaCuenta.map((m) => ({ postedAt: m.posted_at, format: m.format, reach: m.metrics?.reach || m.metrics?.views || 0, contexto: null }))
        const mod = modeloAgenda(perf, perf)
        for (const m of deLaCuenta) {
          const { dow, hour } = arSlot(m.posted_at)
          franjaDe.set(m.id, mod.slot.grid[dow]?.[hour] || 1)
        }
      }
      const items: PostGusto[] = grupo.map((m) => {
        const t = normalizarRasgos(m.traits)
        const p = m.post_id ? postDe.get(m.post_id) : undefined
        const tema = p?.music_track_id ? temaDe.get(p.music_track_id) : undefined
        const rasgos: Record<string, string | null> = {}
        for (const c of RASGO_CAMPOS) rasgos[c] = t[c]
        if (tema) Object.assign(rasgos, rasgosDeTema({ genre: tema.genre, mood: tema.mood ?? [], vocals: tema.vocals, bpm: tema.bpm != null ? Number(tema.bpm) : null, energy: tema.energy != null ? Number(tema.energy) : null }))
        if (p) {
          rasgos.plantilla = p.template
          rasgos.frase = p.overlay_text ? "con_frase" : "sin_frase"
          rasgos.musica = p.music_track_id ? "con_musica" : "sin_musica"
        }
        rasgos.clima = m.contexto?.clima ?? null
        rasgos.feriado = m.contexto?.feriado ? "si" : null
        return { id: m.id, account: m.account_id, format, postedAt: m.posted_at, metrics: a48.get(m.id) ?? m.metrics ?? {}, rasgos, franja: franjaDe.get(m.id) }
      })
      const lifts = liftsPorMetrica(items)
      // Tema usado por cada publicación (si lo publicó Content OS con música).
      const temaDeMedia = new Map(grupo.map((m) => [m.id, m.post_id ? postDe.get(m.post_id)?.music_track_id ?? null : null]))
      for (const objetivo of Object.keys(OBJETIVOS) as Objetivo[]) {
        const conScore = items.map((p) => ({ ...p, score: puntaje(lifts.get(p.id), objetivo) ?? 0 })).filter((p) => p.score > 0)
        if (conScore.length < 20) continue
        const efectos = efectosRasgos(conScore)
        const r = ridge(conScore)
        // Temas de la marca: lo propio contraído hacia lo que se espera por sus rasgos.
        const temasMarca = (temas ?? []).filter((t) => t.brand_id === b.id)
        const temasEf = temasMarca.map((t) => {
          const usos = conScore.filter((p) => temaDeMedia.get(p.id) === t.id)
          const suma = usos.reduce((a, u) => a + Math.log(u.score), 0)
          const e = efectoTema({ suma, n: usos.length }, rasgosDeTema({ genre: t.genre, mood: t.mood ?? [], vocals: t.vocals, bpm: t.bpm != null ? Number(t.bpm) : null, energy: t.energy != null ? Number(t.energy) : null }), efectos)
          const pref = empujon(t.storage_key as string)
          return { track_id: t.id, titulo: t.title, activo: t.active, ...e, efecto: Math.round(e.efecto * pref * 1000) / 1000, preferencia: pref }
        })
        const bt = objetivo === "gusta" ? backtest(conScore) : null
        await db.from("cos_taste_models").insert({
          brand_id: b.id,
          format,
          objective: objetivo,
          model_version: 1,
          n: conScore.length,
          model_json: { efectos, ridge: r, temas: temasEf, backtest: bt, con_rasgos: conScore.filter((p) => RASGO_CAMPOS.some((c) => p.rasgos[c])).length },
        })
        fotos++
        if (bt) log("gustos: backtest", { brand: b.slug, format, ...bt })
      }
    }
  }
  log("modelos de gustos guardados", { fotos })
}

export const tasteHandlers: Record<string, Handler> = { "taste:learn": aprenderGustos }

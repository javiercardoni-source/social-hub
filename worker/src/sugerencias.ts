/**
 * F7 · Motor de gustos (M3) — taste:suggest (lunes, por marca): plan de contenido de la semana,
 * material a pedir a la cocina, música y candidatos a pautar → cos_suggestions (una fila por
 * marca, semana y tipo: el job semanal no duplica). Solo sugiere: nunca toca la API de Ads.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Handler } from "./handlers.ts"
import { brandContext, settings } from "./handlers.ts"
import { escribirSugerencias } from "./ai.ts"
import { candidatosPauta, lunesDe, numerosInventados } from "../../shared/cos/sugerencias.ts"
import { liftsPorMetrica, type EfectoRasgo } from "../../shared/cos/taste.ts"
import { normalizarDatos } from "../../shared/cos/datos-vigentes.ts"
import { normalizarRasgos, RASGO_CAMPOS } from "../../shared/cos/gustos.ts"
import type { Format } from "../../shared/cos/timing.ts"

type Modelo = { format: string; n: number; model_json: { efectos: EfectoRasgo[]; temas: { titulo: string; efecto: number; n: number; activo: boolean }[] } }
const pct = (x: number) => Math.round((x - 1) * 100)

async function guardar(db: SupabaseClient, brandId: string, week: string, kind: string, items: unknown) {
  const { error } = await db.from("cos_suggestions").upsert({ brand_id: brandId, week, kind, items_json: items }, { onConflict: "brand_id,week,kind" })
  if (error) throw new Error(`cos_suggestions: ${error.message}`)
}

const sugerir: Handler = async (job, { db, log }) => {
  const week = lunesDe(new Date())
  const solo = typeof job.payload.brand_id === "string" ? job.payload.brand_id : null
  let q = db.from("cos_brands").select("id, slug, datos_vigentes").eq("active", true)
  if (solo) q = q.eq("id", solo)
  const { data: marcas } = await q
  const s = await settings(db)
  for (const b of marcas ?? []) {
    // Idempotente por semana: si ya están las de esta semana y no se pidió rehacer, no se vuelve a gastar IA.
    const { count } = await db.from("cos_suggestions").select("id", { count: "exact", head: true }).eq("brand_id", b.id).eq("week", week)
    if (count && job.payload.rehacer !== true) continue

    // Lo aprendido: última foto "gusta" por formato.
    const { data: modelosRaw } = await db.from("cos_taste_models").select("format, n, model_json, computed_at").eq("brand_id", b.id).eq("objective", "gusta").order("computed_at", { ascending: false }).limit(20)
    const modelos = new Map<string, Modelo>()
    for (const m of (modelosRaw ?? []) as unknown as (Modelo & { computed_at: string })[]) if (!modelos.has(m.format)) modelos.set(m.format, m)

    // Candidatos a pautar: lo orgánico de los últimos 14 días.
    const desde = new Date(Date.now() - 75 * 86_400_000).toISOString()
    const { data: media } = await db.from("cos_media").select("id, account_id, format, posted_at, metrics, traits, caption, permalink, pautado").eq("brand_id", b.id).gte("posted_at", desde)
    const datos = normalizarDatos(b.datos_vigentes)
    const vigentes = { precios: datos.combos.filter((c) => c.activo && c.precio).map((c) => c.precio), promos: datos.promos.map((p) => p.texto) }
    const posts = (media ?? []).map((m) => ({
      id: m.id as string,
      account: m.account_id as string,
      format: m.format as Format,
      postedAt: m.posted_at as string,
      metrics: (m.metrics ?? {}) as Record<string, number>,
      rasgos: Object.fromEntries(RASGO_CAMPOS.map((c) => [c, normalizarRasgos(m.traits)[c]])),
      caption: (m.caption as string) ?? "",
      permalink: (m.permalink as string) ?? null,
      pautado: !!m.pautado,
    }))
    const candidatos = candidatosPauta(posts, vigentes)
    const L = liftsPorMetrica(posts)
    await guardar(db, b.id, week, "pauta", candidatos.map((c) => ({ ...c, rasgos: posts.find((p) => p.id === c.media_id)?.rasgos ?? {}, lifts: L.get(c.media_id) ?? {} })))

    // Tabla para la IA: solo cifras que el motor calculó (efectos claros, temas, candidatos).
    const lineas: string[] = []
    const permitidos: number[] = []
    for (const [f, m] of modelos) {
      const claros = m.model_json.efectos.filter((e) => e.claro)
      lineas.push(`${f} (${m.n} publicaciones): ${claros.length ? claros.map((e) => `${e.campo}=${e.valor} ${pct(e.efecto) > 0 ? "+" : ""}${pct(e.efecto)} % (${e.n} posts)`).join("; ") : "todavía poca data, ningún rasgo claro"}`)
      permitidos.push(m.n, ...claros.flatMap((e) => [Math.abs(pct(e.efecto)), e.n]))
      const temas = [...m.model_json.temas].filter((t) => t.activo).sort((a, b2) => b2.efecto - a.efecto)
      if (temas.length) {
        lineas.push(`  música (${f}): mejores ${temas.slice(0, 3).map((t) => `${t.titulo} ${pct(t.efecto)} %${t.n ? ` (${t.n} usos)` : " (por sus rasgos)"}`).join(", ")} · peores ${temas.slice(-2).map((t) => `${t.titulo} ${pct(t.efecto)} %`).join(", ")}`)
        permitidos.push(...temas.flatMap((t) => [Math.abs(pct(t.efecto)), t.n]))
      }
    }
    if (!lineas.length) {
      log("sugerencias: todavía sin modelo de gustos para la marca", { brand: b.slug })
      continue
    }
    const brand = await brandContext(db, b.id)
    const texto = `LO QUE APRENDIÓ EL MOTOR (rendimiento vs lo de siempre, descontando el horario):\n${lineas.join("\n")}`
    let sug = await escribirSugerencias({ db, model: s.ai_model, brand, datos: texto }).catch((e) => (log("sugerencias: la IA falló", { brand: b.slug, error: String(e) }), null))
    const inventados = (x: NonNullable<typeof sug>) => numerosInventados([x.resumen, ...x.contenido.flatMap((c) => [c.titulo, c.por_que]), ...x.material.flatMap((m) => [m.toma, m.por_que]), ...x.musica].join(" "), permitidos)
    if (sug && inventados(sug).length) {
      // Un reintento con el aviso; si vuelve a inventar, no se guarda texto de la IA.
      const malos = inventados(sug)
      sug = await escribirSugerencias({ db, model: s.ai_model, brand, datos: texto, pedido: `OJO: en la versión anterior pusiste cifras que no están en los datos (${malos.join(", ")}). Usá solo las de arriba.` }).catch(() => null)
      if (sug && inventados(sug).length) {
        log("sugerencias: la IA inventó cifras dos veces, se descarta el texto", { brand: b.slug, cifras: inventados(sug) })
        sug = null
      }
    }
    if (!sug) {
      // Sin texto de la IA: igual queda la tabla (lo que aprendió el motor), sin redacción.
      await guardar(db, b.id, week, "contenido", { resumen: "La IA no pudo redactar esta semana: abajo, lo que aprendió el motor.", items: lineas.map((l) => ({ titulo: l, por_que: "" })) })
      continue
    }
    await guardar(db, b.id, week, "contenido", { resumen: sug.resumen, items: sug.contenido })
    await guardar(db, b.id, week, "material", { items: sug.material })
    await guardar(db, b.id, week, "musica", { items: sug.musica })
    log("sugerencias de la semana listas", { brand: b.slug, week, contenido: sug.contenido.length, pauta: candidatos.length })
  }
}

export const sugerenciasHandlers: Record<string, Handler> = { "taste:suggest": sugerir }

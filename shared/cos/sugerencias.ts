/**
 * F7 · Motor de gustos (M3): sugerencias de la semana y candidatos a pautar. Puro, con tests.
 *
 *   candidatosPauta   publicaciones orgánicas recientes que rindieron claramente más, por objetivo.
 *                     SOLO sugiere: nunca toca la API de Ads (pautar lo decide Javier en Meta).
 *   numerosInventados la IA redacta las sugerencias; cada número del texto tiene que existir en lo
 *                     que se le pasó. Si inventa uno, la sugerencia se rechaza.
 *   lunesDe           semana de una sugerencia (lunes, Buenos Aires)
 */
import { liftsPorMetrica, puntaje, type Objetivo, type PostGusto } from "./taste.ts"

export type Candidato = {
  media_id: string
  objetivo: Objetivo
  lift: number
  confianza: "alta" | "media"
  /** Qué métricas lo destacan (para el porqué). */
  destaca: string[]
  permalink: string | null
  postedAt: string
  format: string
}

const COMP_LABEL: Record<string, string> = {
  vistas: "alcance",
  interaccion: "interacción",
  retencion: "retención",
  seguidores: "seguidores ganados",
  perfil: "visitas al perfil",
  conversacion: "comentarios y compartidos",
  clics: "clics",
}

/**
 * ¿El texto menciona un precio o una promo que NO está en Datos vigentes? Un post así no se pauta
 * (la plata iría a una oferta vencida o inventada).
 */
export function mencionaAlgoNoVigente(texto: string, vigentes: { precios: string[]; promos: string[] }): boolean {
  const t = (texto ?? "").toLowerCase()
  const precios = [...t.matchAll(/\$\s?\d[\d.,]*/g)].map((m) => m[0].replace(/\s/g, ""))
  const vig = vigentes.precios.map((p) => p.toLowerCase().replace(/\s/g, ""))
  if (precios.some((p) => !vig.some((v) => v.includes(p) || p.includes(v)))) return true
  const hablaDePromo = /\b(promo|promoción|promocion|descuento|\d+\s?%|2x1|off)\b/.test(t)
  return hablaDePromo && !vigentes.promos.some((p) => t.includes(p.toLowerCase().slice(0, 20)))
}

/**
 * Publicaciones orgánicas de los últimos 14 días que rindieron claramente por encima de lo esperado
 * (en sus primeras 48 h), clasificadas por el objetivo en el que más se destacan.
 */
export function candidatosPauta(
  posts: (PostGusto & { caption: string; permalink: string | null; pautado: boolean })[],
  vigentes: { precios: string[]; promos: string[] },
  ahora = Date.now(),
): Candidato[] {
  const L = liftsPorMetrica(posts)
  const out: Candidato[] = []
  for (const p of posts) {
    const edad = ahora - Date.parse(p.postedAt)
    if (p.format === "story" || p.pautado || edad > 14 * 86_400_000 || edad < 36 * 3600_000) continue
    if (mencionaAlgoNoVigente(p.caption, vigentes)) continue
    const l = L.get(p.id)
    if (!l) continue
    const porObjetivo = (["crece", "conversa", "gusta"] as Objetivo[])
      .map((o) => ({ o, s: puntaje(l, o) }))
      .filter((x): x is { o: Objetivo; s: number } => x.s != null)
      .sort((a, b) => b.s - a.s)
    const mejor = porObjetivo[0]
    if (!mejor || mejor.s < 1.4) continue
    // Cuántos componentes lo respaldan: con uno solo, confianza media.
    const destaca = Object.entries(l).filter(([, v]) => v >= 1.3).map(([k]) => COMP_LABEL[k] ?? k)
    out.push({
      media_id: p.id,
      objetivo: mejor.o === "gusta" ? "crece" : mejor.o, // "gusta" en pauta = alcance/reconocimiento
      lift: Math.round(mejor.s * 100) / 100,
      confianza: destaca.length >= 2 && mejor.s >= 1.6 ? "alta" : "media",
      destaca,
      permalink: p.permalink,
      postedAt: p.postedAt,
      format: p.format,
    })
  }
  return out.sort((a, b) => b.lift - a.lift).slice(0, 6)
}

/**
 * Números del texto que no aparecen en los datos que se le pasaron a la IA (porcentajes, cantidades).
 * Vacío = el texto no inventó cifras.
 */
export function numerosInventados(texto: string, permitidos: (number | string)[]): string[] {
  const ok = new Set(permitidos.map((n) => String(n).replace(",", ".")))
  const encontrados = [...(texto ?? "").matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(",", "."))
  // Días de la semana/horas escritos como números chicos (1 a 7, 10 s, 2 reels) se aceptan si ≤ 10.
  return [...new Set(encontrados.filter((n) => !ok.has(n) && Number(n) > 10))]
}

/** Lunes (YYYY-MM-DD) de la semana de un instante, en Buenos Aires. */
export function lunesDe(at: Date): string {
  const t = new Date(at.getTime() - 3 * 3600_000)
  const dow = t.getUTCDay()
  t.setUTCDate(t.getUTCDate() - ((dow + 6) % 7))
  return t.toISOString().slice(0, 10)
}

/** Rasgo en palabras (para la IA y para Javier): "luz cálida", "plano cenital (desde arriba)". */
const RASGO_TEXTO: Record<string, Record<string, string>> = {
  plano: { primer_plano: "primer plano", cenital: "plano cenital (desde arriba)", medio: "plano medio", ambiente: "plano de ambiente" },
  protagonista: { producto: "el producto de protagonista", manos_proceso: "manos / proceso", persona: "personas", local: "el local", placa: "placas gráficas" },
  accion: { vapor: "con vapor", corte: "con corte", armado: "armado", salsa: "salsa cayendo", servido: "emplatado/servido", nada: "producto quieto" },
  luz_temp: { calida: "luz cálida", fria: "luz fría" },
  luz_nivel: { clara: "luz clara", oscura: "luz oscura" },
  fondo: { limpio: "fondo limpio", cargado: "fondo cargado" },
  genero: {},
  plantilla: { banda: "plantilla banda", etiqueta: "plantilla etiqueta", firma: "solo firma", none: "sin plantilla" },
  frase: { con_frase: "con frase sobre la imagen", sin_frase: "sin frase sobre la imagen" },
  musica: { con_musica: "con música", sin_musica: "sin música" },
  clima: { lluvia: "días de lluvia", tormenta: "días de tormenta", frio: "días de frío", calor: "días de calor", soleado: "días soleados", nublado: "días nublados" },
  feriado: { si: "feriados" },
}
export function rasgoEnPalabras(campo: string, valor: string): string {
  return RASGO_TEXTO[campo]?.[valor] ?? (campo === "genero" ? `música ${valor}` : `${campo.replace(/_/g, " ")}: ${valor.replace(/_/g, " ")}`)
}

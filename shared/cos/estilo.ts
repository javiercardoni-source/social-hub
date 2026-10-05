/**
 * Referencias de estilo por formato (Marca → Motores). Puro, con tests: lo usan la app y el worker.
 *
 *   paraPorDefecto   el formato que se le pone a una referencia nueva según su archivo
 *   resumenEstilo    lo que lee cada motor: las fichas de SU formato, resumidas para el prompt
 */

export const PARAS = ["post", "reel", "historia"] as const
export type Para = (typeof PARAS)[number]
export const PARA_TEXTO: Record<Para, string> = { post: "Posts", reel: "Reels", historia: "Historias" }
export const PARA_AYUDA: Record<Para, string> = {
  post: "Placas y fotos de feed: composición, tipografía, cuánto texto y dónde, colores.",
  reel: "Videos: ritmo de cortes, duración de cada toma, planos, acercamientos, transiciones, cuándo entra el texto.",
  historia: "Historias: texto grande y corto, una sola idea, fondos y llamado a la acción.",
}

/** Video → reel; imagen vertical (9:16 o más alta) → historia; el resto → post. */
export function paraPorDefecto(mime: string, ancho?: number | null, alto?: number | null): Para {
  if (mime.startsWith("video/")) return "reel"
  if (ancho && alto && alto / ancho >= 1.6) return "historia"
  return "post"
}

/** Lo que guarda la IA de cada referencia (worker/src/ai.ts → FichaEstilo + medidas de ffmpeg). */
export type FichaRef = {
  resumen?: string
  ritmo?: string
  planos?: string[]
  movimientos?: string[]
  transiciones?: string[]
  texto_en_pantalla?: string
  tipografia?: string
  paleta?: string[]
  estructura?: string[]
  para_nuestras_piezas?: string[]
  evitar?: string[]
  medidas?: { duracion_s: number; cortes: number; toma_promedio_s: number } | null
}

const lista = (xs: (string | undefined)[], max: number) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim()))].slice(0, max)

/**
 * El bloque de estilo que va en el prompt de un motor. Solo las fichas de ese formato (las últimas 8).
 * "" si no hay ninguna: el motor sigue como siempre.
 */
export function resumenEstilo(fichas: FichaRef[], para: Para): string {
  const fs = fichas.filter(Boolean).slice(0, 8)
  if (!fs.length) return ""
  const l: string[] = [
    `ESTILO DE LA MARCA PARA ${PARA_TEXTO[para].toUpperCase()} (sale de ${fs.length} referencia${fs.length > 1 ? "s" : ""} que eligió el dueño; seguilo, sin copiar marcas ni productos ajenos).`,
    "Tomá solo la forma (ritmo, encuadre, tipografía, composición). Nunca copies precios, sellos («sin TACC», «gluten free»), fechas especiales ni promos que aparezcan en las referencias.",
  ]
  const resumenes = lista(fs.map((f) => f.resumen), 4)
  if (resumenes.length) l.push(`- Qué le gusta: ${resumenes.join(" / ")}`)
  if (para === "reel") {
    const med = fs.map((f) => f.medidas).filter((m): m is NonNullable<FichaRef["medidas"]> => !!m && m.toma_promedio_s > 0)
    if (med.length) {
      const toma = med.reduce((s, m) => s + m.toma_promedio_s, 0) / med.length
      l.push(`- Ritmo medido en las referencias: una toma cada ${toma.toFixed(1)} s en promedio (${med.length} video${med.length > 1 ? "s" : ""}).`)
    }
    const ritmos = lista(fs.map((f) => f.ritmo), 3)
    if (ritmos.length) l.push(`- Ritmo: ${ritmos.join(" / ")}`)
    const planos = lista(fs.flatMap((f) => f.planos ?? []), 6)
    if (planos.length) l.push(`- Planos: ${planos.join(", ")}`)
    const mov = lista(fs.flatMap((f) => f.movimientos ?? []), 6)
    if (mov.length) l.push(`- Movimientos: ${mov.join(", ")}`)
    const tr = lista(fs.flatMap((f) => f.transiciones ?? []), 4)
    if (tr.length) l.push(`- Transiciones: ${tr.join(", ")}`)
    const est = lista(fs.flatMap((f) => f.estructura ?? []), 6)
    if (est.length) l.push(`- Estructura típica: ${est.join(" → ")}`)
  }
  const texto = lista(fs.map((f) => f.texto_en_pantalla), 3)
  if (texto.length) l.push(`- Texto en pantalla: ${texto.join(" / ")}`)
  if (para !== "reel") {
    const tipo = lista(fs.map((f) => f.tipografia), 2)
    if (tipo.length) l.push(`- Tipografía y jerarquía: ${tipo.join(" / ")}`)
    const est = lista(fs.flatMap((f) => f.estructura ?? []), 4)
    if (est.length) l.push(`- Composición: ${est.join(" / ")}`)
  }
  const tomar = lista(fs.flatMap((f) => f.para_nuestras_piezas ?? []), 6)
  if (tomar.length) l.push(`- Tomar para nuestras piezas: ${tomar.join("; ")}`)
  const evitar = lista(fs.flatMap((f) => f.evitar ?? []), 5)
  if (evitar.length) l.push(`- Evitar: ${evitar.join("; ")}`)
  return l.join("\n")
}

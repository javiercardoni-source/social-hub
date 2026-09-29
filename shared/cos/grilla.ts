/**
 * Grilla del perfil de Instagram (F6): orden, columnas y estilo por columna. Sin dependencias.
 *
 * Instagram muestra lo más nuevo arriba a la izquierda y cada publicación nueva corre a todas un
 * lugar. La columna de una pieza (0 izq · 1 centro · 2 der) es su índice % 3 en la grilla del
 * momento: por eso se evalúa la grilla "cuando salga todo lo programado".
 */

export type EstadoPieza = "publicado" | "programado" | "pendiente"
export type Pieza = {
  id: string
  estado: EstadoPieza
  at: string | null // publicado: cuándo salió · programado: cuándo sale · pendiente: null
  formato: "feed" | "reel" | "carousel"
  conTexto: boolean | null // null = no se sabe (publicado sin analizar)
}

export type ReglaColumna = "con_texto" | "sin_texto" | "libre"
export type EstiloGrilla = { columnas: [ReglaColumna, ReglaColumna, ReglaColumna] }
export const ESTILO_LIBRE: EstiloGrilla = { columnas: ["libre", "libre", "libre"] }

/** ¿La pieza nuestra lleva texto encima? (firma = solo el logo chico, no cuenta). */
export const llevaTexto = (template: string, overlay: string | null) => (template === "banda" || template === "etiqueta") && !!overlay?.trim()

/**
 * Orden de la grilla: pendientes (sin fecha, irían después de lo programado), programados del más
 * lejano al más próximo, y lo publicado del más nuevo al más viejo.
 */
export function ordenarGrilla(piezas: Pieza[]): Pieza[] {
  const t = (p: Pieza) => (p.at ? new Date(p.at).getTime() : 0)
  const pend = piezas.filter((p) => p.estado === "pendiente")
  const prog = piezas.filter((p) => p.estado === "programado").sort((a, b) => t(b) - t(a))
  const pub = piezas.filter((p) => p.estado === "publicado").sort((a, b) => t(b) - t(a))
  return [...pend, ...prog, ...pub]
}

export type Marca = "ok" | "rompe" | "sin_regla" | "desconocido"

/** Cómo cumple cada pieza la regla de su columna (lo publicado solo si se sabe si tiene texto). */
export function evaluarEstilo(grilla: Pieza[], estilo: EstiloGrilla): Marca[] {
  return grilla.map((p, i) => {
    const regla = estilo.columnas[i % 3]
    if (regla === "libre") return "sin_regla"
    if (p.conTexto == null) return "desconocido"
    return (regla === "con_texto") === p.conTexto ? "ok" : "rompe"
  })
}

/** Normaliza lo guardado (o lo que manda la IA) a un estilo válido. */
export function normalizarEstilo(raw: unknown): EstiloGrilla {
  const cols = (raw as { columnas?: unknown } | null)?.columnas
  const ok = (x: unknown): ReglaColumna => (x === "con_texto" || x === "sin_texto" ? x : "libre")
  return Array.isArray(cols) && cols.length === 3 ? { columnas: [ok(cols[0]), ok(cols[1]), ok(cols[2])] } : ESTILO_LIBRE
}

/** Para mostrar: "Izquierda con texto · Centro sin texto · Derecha con texto". */
export function describirEstilo(e: EstiloGrilla): string {
  const nom = ["Izquierda", "Centro", "Derecha"]
  const txt: Record<ReglaColumna, string> = { con_texto: "con texto", sin_texto: "sin texto", libre: "libre" }
  return e.columnas.map((c, i) => `${nom[i]} ${txt[c]}`).join(" · ")
}

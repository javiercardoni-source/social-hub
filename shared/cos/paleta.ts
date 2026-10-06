/**
 * Paleta de la marca (elegida por Javier el 06-10-2026 en el mockup de paletas). Vive en
 * `cos_brands.paleta` y reemplaza a los colores fijos del KIT de cada marca:
 *
 *   fondo        franja de la plantilla «banda», fondo de los reels con marcos inclinados
 *   titulo       color de la frase sobre la franja
 *   acento       cartel de la plantilla «etiqueta» y recuadro de la placa final del reel
 *   acentoTexto  texto que va sobre el acento
 */
export type Paleta = { fondo: string; titulo: string; acento: string; acentoTexto: string }

export const CAMPOS_PALETA = ["fondo", "titulo", "acento", "acentoTexto"] as const

const HEX = /^#[0-9a-f]{6}$/i

/** La paleta si es válida (los 4 colores en #rrggbb), si no null: se sigue con la del KIT. */
export function leerPaleta(x: unknown): Paleta | null {
  if (!x || typeof x !== "object") return null
  const o = x as Record<string, unknown>
  for (const c of CAMPOS_PALETA) if (typeof o[c] !== "string" || !HEX.test(o[c] as string)) return null
  return { fondo: o.fondo as string, titulo: o.titulo as string, acento: o.acento as string, acentoTexto: o.acentoTexto as string }
}

/** #rrggbb con transparencia, para la franja (deja ver un poco la foto). */
export function conAlfa(hex: string, alfa: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alfa})`
}

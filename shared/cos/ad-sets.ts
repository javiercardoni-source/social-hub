/**
 * Sets de anuncios a pedido (Anuncios → «Crear set», 10-10-2026). Javier escribe el texto que va
 * sobre la pieza y los detalles; la IA hace versiones y elige material real; el worker arma cada
 * versión en 9:16 y 4:5. Lo usan la app (validar el pedido) y el worker (repartir el material).
 * Sin dependencias.
 */

export const FUENTES_SET = ["instagram", "archivo", "manual"] as const
export type FuenteSet = (typeof FUENTES_SET)[number]

export const FORMATOS_SET = ["video", "imagen", "ambos"] as const
export type FormatoSet = (typeof FORMATOS_SET)[number]

export type Elegido = { origen: "instagram" | "archivo"; id: string }

export const FUENTE_TEXTO: Record<FuenteSet, string> = {
  instagram: "Lo publicado en Instagram",
  archivo: "El Archivo (lo que mandan los empleados)",
  manual: "Lo elijo yo",
}

/** Máximo de letras del texto que va sobre la pieza (más que eso no se lee en un anuncio). */
export const MAX_TEXTO_PIEZA = 60
/** Material que se le da a cada video (una toma por archivo). */
export const TOMAS_POR_VIDEO = 4

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIN_TACC = /sin\s*tacc|gluten|cel[ií]ac/i
// Un precio: «$31.900», «31900 pesos», «12 mil». «40 piezas» no es precio.
const PRECIO = /\$\s?\d|\d[\d.,]*\s*(mil\b|pesos|lucas)/i

export type PedidoSet = {
  textos: string
  detalles: string | null
  versiones: number
  formato: FormatoSet
  fuentes: FuenteSet[]
  elegidos: Elegido[]
}

/** Limpia y valida lo que llega del formulario. Devuelve el pedido o el mensaje del problema. */
export function validarPedido(input: {
  textos: unknown
  detalles?: unknown
  versiones?: unknown
  formato?: unknown
  fuentes?: unknown
  elegidos?: unknown
}): PedidoSet | string {
  const textos = typeof input.textos === "string" ? input.textos.trim().replace(/\n{3,}/g, "\n\n") : ""
  if (textos.length < 2) return "Escribí el texto que va sobre la pieza"
  if (textos.length > 300) return "El texto es muy largo (máximo 300 letras)"
  if (SIN_TACC.test(textos)) return "Nada de «sin TACC / gluten / celíacos» sobre la pieza"
  const detalles = typeof input.detalles === "string" && input.detalles.trim() ? input.detalles.trim().slice(0, 1500) : null
  const versiones = Number(input.versiones ?? 3)
  if (!Number.isInteger(versiones) || versiones < 1 || versiones > 6) return "Las versiones van de 1 a 6"
  const formato = (FORMATOS_SET as readonly string[]).includes(input.formato as string) ? (input.formato as FormatoSet) : "ambos"
  const fuentes = [...new Set(Array.isArray(input.fuentes) ? input.fuentes : [])].filter((f): f is FuenteSet => (FUENTES_SET as readonly string[]).includes(f as string))
  if (!fuentes.length) return "Elegí de dónde sale el material"
  const elegidos = (Array.isArray(input.elegidos) ? input.elegidos : [])
    .filter((e): e is Elegido => !!e && typeof e === "object" && ["instagram", "archivo"].includes((e as Elegido).origen) && UUID.test(String((e as Elegido).id)))
    .map((e) => ({ origen: e.origen, id: e.id }))
    .filter((e, i, xs) => xs.findIndex((x) => x.origen === e.origen && x.id === e.id) === i)
    .slice(0, 12)
  if (fuentes.includes("manual") && !elegidos.length) return "Marcaste «Lo elijo yo»: elegí al menos una foto o video"
  return { textos, detalles, versiones, formato, fuentes, elegidos: fuentes.includes("manual") ? elegidos : [] }
}

/** Avisos (no bloquean): cosas que conviene no poner sobre la pieza. */
export function avisosTexto(textos: string): string[] {
  const out: string[] = []
  if (PRECIO.test(textos)) out.push("Tiene un precio: en los anuncios el precio va en el texto del anuncio, no sobre la pieza (Meta y el motor lo marcan)")
  const largo = textos.split("\n").find((l) => l.trim().length > MAX_TEXTO_PIEZA)
  if (largo) out.push(`Hay una línea de más de ${MAX_TEXTO_PIEZA} letras: sobre la pieza no se va a leer`)
  return out
}

/** Problemas de un texto que escribió la IA para la pieza. Vacío = se puede usar. */
export function problemasTextoPieza(t: string): string[] {
  const out: string[] = []
  if (!t.trim()) out.push("vacío")
  if (t.length > MAX_TEXTO_PIEZA) out.push("muy largo")
  if (SIN_TACC.test(t)) out.push("menciona «sin TACC / gluten / celíacos»")
  if (PRECIO.test(t)) out.push("tiene precio")
  return out
}

/**
 * Qué material usa cada versión: cada una arranca en otro archivo para que no salgan todas
 * iguales (con 5 archivos y 3 versiones: [0,1,2,3] · [1,2,3,4] · [2,3,4,0]). Con menos archivos
 * que versiones, se repite en otro orden.
 */
export function repartirMaterial(cantidad: number, versiones: number, porVersion = TOMAS_POR_VIDEO): number[][] {
  if (cantidad <= 0) return Array.from({ length: versiones }, () => [])
  const n = Math.min(porVersion, cantidad)
  return Array.from({ length: versiones }, (_, v) => Array.from({ length: n }, (_, i) => (v + i) % cantidad))
}

/** Nombre del archivo para descargar: «fasutofudo-v2-9x16.mp4». */
export function nombreDescarga(marca: string, numero: number, formato: string, tipo: "video" | "imagen"): string {
  return `${marca}-v${numero}-${formato}.${tipo === "video" ? "mp4" : "jpg"}`
}

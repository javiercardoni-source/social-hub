/**
 * F11 · Motor de Vitrinas (docs/PLAN-MOTOR-VITRINAS.md) — la parte pura, con tests.
 *
 *   slugVitrina      slug impredecible: «onigiris-oct-k3x9q2»
 *   mensajeWhatsApp  el mensaje que le aparece escrito al cliente (sale del page_welcome_message)
 *   chipOferta       la oferta corta para la etiqueta (el primer precio del título)
 *   nombreAnuncio    «AD_FF_C_con-la-mano» → «C · Con la mano»
 *   aRetirar         rotación: qué vitrinas se retiran para quedar en N por marca
 *   vigente          cuál muestra el link fijo de la marca
 *   textoCompartir   lo que se copia al portapapeles al compartir (con la mención a la marca)
 *   textoProhibido   «sin TACC / sin gluten / apto celíacos»: ese anuncio no entra
 */

export type EstadoVitrina = "armando" | "lista" | "aprobada" | "retirada" | "error"
export type VitrinaFila = { id: string; estado: EstadoVitrina; created_at: string; approved_at?: string | null }

const ALFABETO = "abcdefghjkmnpqrstuvwxyz23456789"

/** Slug con un pedazo legible (del título) y 6 letras al azar. */
export function slugVitrina(titulo: string, azar: () => number = Math.random): string {
  const base = titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter((w) => w.length > 2)
    .slice(0, 3)
    .join("-")
    .slice(0, 40)
  const cola = Array.from({ length: 6 }, () => ALFABETO[Math.floor(azar() * ALFABETO.length)]).join("")
  return base ? `${base}-${cola}` : `vitrina-${cola}`
}

/**
 * El page_welcome_message de Meta es un JSON en texto; el mensaje pre-escrito está en
 * text_format.message.autofill_message.content. null si no hay.
 */
export function mensajeWhatsApp(welcome: string | null | undefined): string | null {
  if (!welcome) return null
  try {
    const w = JSON.parse(welcome) as { text_format?: { message?: { autofill_message?: { content?: string }; text?: string } } }
    const t = w.text_format?.message?.autofill_message?.content ?? w.text_format?.message?.text
    return t?.trim() || null
  } catch {
    return null
  }
}

/** «Combo 5 Onigiris · $15.000» → «$15.000». */
export function chipOferta(titulo: string | null | undefined): string | null {
  const m = (titulo ?? "").match(/\$\s?\d[\d.,]*/)
  return m ? m[0].replace(/\s/g, "") : null
}

/** Nombre corto para la tarjeta, a partir del nombre del anuncio. */
export function nombreAnuncio(nombre: string | null | undefined, i: number): string {
  let n = (nombre ?? "").trim()
  // «AD_FF_C_con-la-mano» / «MOTOR · 40 piezas · 9x16»
  n = n.replace(/^MOTOR\s*·\s*/i, "").replace(/\s*·\s*(9x16|4x5|original)$/i, "")
  const m = n.match(/^AD_[A-Z]+_([A-Z])_(.+)$/)
  if (m) return `${m[1]} · ${cap(m[2].replace(/[-_]+/g, " "))}`
  if (!n || /^Promoción del sitio/i.test(n)) return `Anuncio ${i + 1}`
  return cap(n.replace(/[_]+/g, " ")).slice(0, 48)
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Las que se retiran para que queden `max` vivas (las más viejas primero). Nunca la recién creada. */
export function aRetirar(vs: VitrinaFila[], max: number, nueva: string): string[] {
  const vivas = vs.filter((v) => v.estado !== "retirada" && v.estado !== "error").sort((a, b) => b.created_at.localeCompare(a.created_at))
  return vivas.filter((v) => v.id !== nueva).slice(Math.max(0, max - 1)).map((v) => v.id)
}

/** La del link fijo: la última aprobada; si no hay ninguna aprobada, la última lista. */
export function vigente<T extends VitrinaFila>(vs: T[]): T | null {
  const orden = (a: T, b: T) => (b.approved_at ?? b.created_at).localeCompare(a.approved_at ?? a.created_at)
  return [...vs].filter((v) => v.estado === "aprobada").sort(orden)[0] ?? [...vs].filter((v) => v.estado === "lista").sort(orden)[0] ?? null
}

/** Lo que se copia al compartir: Instagram no recibe texto en historias, así que va al portapapeles. */
export function textoCompartir(p: { usuario: string | null; titulo: string }): string {
  const arroba = p.usuario ? (p.usuario.startsWith("@") ? p.usuario : `@${p.usuario}`) : ""
  return [p.titulo.replace(/\s*·?\s*\$\s?\d[\d.,]*/g, "").trim(), arroba].filter(Boolean).join(" ")
}

const SIN_TACC = /sin\s*tacc|gluten|cel[ií]ac/i
export const textoProhibido = (t: string | null | undefined) => SIN_TACC.test(t ?? "")

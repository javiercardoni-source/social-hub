/**
 * Por qué se rechaza un post y cómo eso vuelve a la IA. Puro, con tests (app y worker).
 *
 *   MOTIVOS             los chips de la pantalla (uno o varios, más una explicación libre)
 *   validarRechazo      al menos un motivo o una explicación
 *   leccionesDeRechazos el bloque que lee la IA: lo que el dueño rechazó últimamente, para no repetirlo
 */

export const MOTIVOS = [
  { id: "texto", label: "El texto no me gusta", leccion: "textos que no le gustaron" },
  { id: "voz", label: "No suena a la marca", leccion: "textos que no sonaban a la marca" },
  { id: "dato", label: "Dato equivocado (precio, combo, horario)", leccion: "datos equivocados (precio, combo u horario)" },
  { id: "frase", label: "La frase sobre la imagen", leccion: "frases sobre la imagen que no funcionaron" },
  { id: "foto", label: "La foto o el video no sirve", leccion: "material que no sirve" },
  { id: "diseno", label: "El diseño tapa o queda mal", leccion: "diseños que tapaban el producto o quedaban mal" },
  { id: "musica", label: "La música", leccion: "música que no encajaba" },
  { id: "ia", label: "Parece hecho con IA", leccion: "piezas que parecían hechas con IA" },
  { id: "repetido", label: "Repetido / ya salió algo igual", leccion: "contenido repetido" },
  { id: "momento", label: "No es el momento", leccion: "contenido fuera de momento" },
] as const
export type MotivoId = (typeof MOTIVOS)[number]["id"]
const IDS = new Set<string>(MOTIVOS.map((m) => m.id))

/** Motivos que dicen que el MATERIAL no sirve: ese archivo no se vuelve a proponer. */
export const MOTIVOS_DE_MATERIAL: MotivoId[] = ["foto", "ia"]

export function validarRechazo(motivos: string[], nota: string): string | null {
  const ok = motivos.filter((m) => IDS.has(m))
  if (ok.length !== motivos.length) return "Motivo inválido"
  if (!ok.length && !nota.trim()) return "Elegí un motivo o contá por qué: con eso el motor aprende."
  if (nota.length > 500) return "La explicación es muy larga (máximo 500 letras)"
  return null
}

export type Rechazo = { reasons: string[]; note: string | null; post_type: string; caption: string | null; overlay_text: string | null; at: string }

/**
 * Lo que lee la IA. Los motivos contados (qué falla más) y las explicaciones textuales, con un
 * pedacito de lo rechazado para que entienda el ejemplo. "" si no hay rechazos.
 */
export function leccionesDeRechazos(rs: Rechazo[], max = 15): string {
  const lista = [...rs].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40)
  if (!lista.length) return ""
  const cuenta = new Map<string, number>()
  for (const r of lista) for (const m of r.reasons) cuenta.set(m, (cuenta.get(m) ?? 0) + 1)
  const l: string[] = ["LO QUE EL DUEÑO RECHAZÓ ÚLTIMAMENTE (aprendé de esto y no lo repitas):"]
  const top = [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${MOTIVOS.find((x) => x.id === m)?.leccion ?? m} (${n})`)
  if (top.length) l.push(`- Lo que más rechaza: ${top.join(", ")}.`)
  const vistos = new Set<string>()
  for (const r of lista) {
    const nota = r.note?.trim()
    if (!nota || vistos.has(nota.toLowerCase())) continue
    vistos.add(nota.toLowerCase())
    const ej = (r.overlay_text?.trim() || r.caption?.trim() || "").replace(/\s+/g, " ").slice(0, 90)
    l.push(`- «${nota}»${ej ? ` (sobre: "${ej}")` : ""}`)
    if (vistos.size >= max) break
  }
  return l.join("\n")
}

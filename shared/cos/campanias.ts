/**
 * Campañas por temporada (07-10-2026). Una campaña tiene fechas y una idea: temporada (estación),
 * fecha comercial (Día de la Madre, Navidad…) o propia. La IA usa la vigente y la próxima al
 * escribir; el calendario las muestra como franjas. Sin dependencias: worker y app.
 */

export type TipoCampania = "temporada" | "comercial" | "propia"
export type Campania = {
  id: string
  nombre: string
  tipo: TipoCampania
  desde: string // YYYY-MM-DD
  hasta: string
  objetivo: string
  mensaje: string
  productos: string
  tono: string
  color: string
  activa: boolean
}

export const TIPOS_CAMPANIA: { id: TipoCampania; label: string }[] = [
  { id: "temporada", label: "Temporada" },
  { id: "comercial", label: "Fecha comercial" },
  { id: "propia", label: "Propia" },
]

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const COLOR = /^#[0-9a-fA-F]{6}$/

/** Valida lo que carga Javier. Devuelve el texto del error o la campaña lista para guardar. */
export function validarCampania(x: Partial<Record<keyof Campania, unknown>>): Omit<Campania, "id" | "activa"> | string {
  const t = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "")
  const nombre = t(x.nombre, 80)
  if (!nombre) return "Ponele un nombre a la campaña"
  const desde = typeof x.desde === "string" && FECHA.test(x.desde) ? x.desde : ""
  const hasta = typeof x.hasta === "string" && FECHA.test(x.hasta) ? x.hasta : ""
  if (!desde || !hasta) return "Elegí desde y hasta cuándo va"
  if (hasta < desde) return "La fecha de fin es anterior a la de inicio"
  const tipo = (["temporada", "comercial", "propia"] as const).includes(x.tipo as TipoCampania) ? (x.tipo as TipoCampania) : "propia"
  const color = typeof x.color === "string" && COLOR.test(x.color) ? x.color : "#64748b"
  return { nombre, tipo, desde, hasta, objetivo: t(x.objetivo, 300), mensaje: t(x.mensaje, 300), productos: t(x.productos, 200), tono: t(x.tono, 120), color }
}

/** Las campañas activas que tocan un día (las comerciales y propias primero: son más específicas). */
export function campaniasDelDia(lista: Campania[], dia: string): Campania[] {
  const peso = (c: Campania) => (c.tipo === "temporada" ? 1 : 0)
  return lista.filter((c) => c.activa && c.desde <= dia && dia <= c.hasta).sort((a, b) => peso(a) - peso(b) || a.desde.localeCompare(b.desde))
}

const corta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

function describir(c: Campania): string {
  const partes = [
    `${c.nombre} (${corta(c.desde)} al ${corta(c.hasta)})`,
    c.objetivo && `objetivo: ${c.objetivo}`,
    c.mensaje && `mensaje: ${c.mensaje}`,
    c.productos && `productos foco: ${c.productos}`,
    c.tono && `tono: ${c.tono}`,
  ].filter(Boolean)
  return partes.join(" · ")
}

/**
 * Bloque para el system prompt: lo vigente hoy y lo que empieza en los próximos 21 días (las piezas
 * se escriben antes de salir). "" = sin campañas.
 */
export function campaniasParaIA(lista: Campania[], hoy: string): string {
  const vigentes = campaniasDelDia(lista, hoy)
  const limite = new Date(Date.parse(`${hoy}T12:00:00Z`) + 21 * 86_400_000).toISOString().slice(0, 10)
  const proximas = lista.filter((c) => c.activa && c.desde > hoy && c.desde <= limite).sort((a, b) => a.desde.localeCompare(b.desde))
  if (!vigentes.length && !proximas.length) return ""
  return [
    ...vigentes.map((c) => `- Vigente: ${describir(c)}`),
    ...proximas.map((c) => `- Próxima: ${describir(c)}`),
  ].join("\n")
}

/**
 * Datos comerciales vigentes de una marca: lo que cambia seguido (precios, combos, promos,
 * horarios, zonas, canales). El brandbook dice CÓMO habla la marca; esto dice QUÉ es cierto hoy.
 * La IA solo puede mencionar precios, promos, horarios o links que estén acá.
 * Sin dependencias: lo usan el worker (Node 24) y la app.
 */

export type Combo = { nombre: string; detalle: string; precio: string; activo: boolean }
export type Promo = { texto: string; hasta: string | null } // hasta = YYYY-MM-DD inclusive; null = sin fecha
export type Link = { nombre: string; url: string }

export type DatosVigentes = {
  horarios: string
  zonas: string
  whatsapp: string
  web: string
  retiro: string
  links: Link[]
  combos: Combo[]
  promos: Promo[]
  notas: string
}

export const DATOS_VACIOS: DatosVigentes = { horarios: "", zonas: "", whatsapp: "", web: "", retiro: "", links: [], combos: [], promos: [], notas: "" }

const txt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [])
const fecha = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

/** Limpia lo que venga (formulario o base): recorta, descarta filas vacías y limita tamaños. */
export function normalizarDatos(raw: unknown): DatosVigentes {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return {
    horarios: txt(r.horarios, 300),
    zonas: txt(r.zonas, 500),
    whatsapp: txt(r.whatsapp, 60),
    web: txt(r.web, 200),
    retiro: txt(r.retiro, 200),
    links: arr(r.links)
      .map((l) => ({ nombre: txt(l.nombre, 80), url: txt(l.url, 300) }))
      .filter((l) => l.url)
      .slice(0, 20),
    combos: arr(r.combos)
      .map((c) => ({ nombre: txt(c.nombre, 80), detalle: txt(c.detalle, 300), precio: txt(c.precio, 40), activo: c.activo !== false }))
      .filter((c) => c.nombre)
      .slice(0, 40),
    promos: arr(r.promos)
      .map((p) => ({ texto: txt(p.texto, 300), hasta: fecha(p.hasta) }))
      .filter((p) => p.texto)
      .slice(0, 20),
    notas: txt(r.notas, 1500),
  }
}

/**
 * El bloque que lee la IA. Solo entra lo vigente a `hoy` (YYYY-MM-DD, Buenos Aires): combos
 * activos y promos sin vencer. Devuelve "" si no hay nada cargado.
 */
export function datosParaIA(d: DatosVigentes, hoy: string): string {
  const combos = d.combos.filter((c) => c.activo)
  const promos = d.promos.filter((p) => !p.hasta || p.hasta >= hoy)
  const l: string[] = []
  if (d.horarios) l.push(`- Horarios: ${d.horarios}`)
  if (d.zonas) l.push(`- Zonas de envío: ${d.zonas}`)
  if (d.retiro) l.push(`- Retiro: ${d.retiro}`)
  if (d.whatsapp) l.push(`- WhatsApp para pedir: ${d.whatsapp}`)
  if (d.web) l.push(`- Web para pedir: ${d.web}`)
  for (const k of d.links) l.push(`- Link ${k.nombre || ""}: ${k.url}`.replace("Link :", "Link:"))
  if (combos.length) {
    l.push("- Combos vigentes:")
    for (const c of combos) l.push(`  · ${c.nombre}${c.detalle ? ` — ${c.detalle}` : ""}${c.precio ? ` — ${c.precio}` : " — (sin precio cargado: no menciones precio)"}`)
  }
  if (promos.length) {
    l.push("- Promos activas:")
    for (const p of promos) l.push(`  · ${p.texto}${p.hasta ? ` (hasta el ${p.hasta.slice(8)}/${p.hasta.slice(5, 7)})` : ""}`)
  }
  if (d.notas) l.push(`- Notas: ${d.notas}`)
  return l.join("\n")
}

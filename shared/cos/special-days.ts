/**
 * Fechas especiales del rubro (F4). Calculadas por año; cada una con una idea de contenido
 * para marcas de comida con delivery. Los feriados oficiales vienen aparte (argentinadatos).
 * Sin dependencias: lo usan el worker, la web y los tests.
 */

export type SpecialDay = { day: string; name: string; kind: "especial"; hint: string }

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`

/** n-ésimo día de la semana (0 = domingo) de un mes. */
export function nthWeekday(y: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay()
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7
  return iso(y, month, day)
}

export function specialDaysFor(y: number): SpecialDay[] {
  // Black Friday: viernes siguiente al 4.º jueves de noviembre.
  const thanksgiving = Number(nthWeekday(y, 11, 4, 4).slice(8))
  return [
    { day: iso(y, 2, 14), name: "San Valentín", hint: "Combos para dos, plan de pedir y quedarse en casa" },
    { day: iso(y, 3, 8), name: "Día de la Mujer", hint: "Reconocer al equipo; nada de promos oportunistas" },
    { day: iso(y, 6, 18), name: "Día Internacional del Sushi", hint: "La fecha del rubro: producto protagonista, curiosidades del sushi" },
    { day: nthWeekday(y, 6, 0, 3), name: "Día del Padre", hint: "Plan de domingo en familia, combos para compartir" },
    { day: iso(y, 7, 20), name: "Día del Amigo", hint: "Juntada con amigos, combos grandes, etiquetá a tu amigo" },
    { day: nthWeekday(y, 8, 0, 3), name: "Día del Niño", hint: "Plan familiar; cuidado con mensajes dirigidos a menores" },
    { day: iso(y, 9, 21), name: "Día de la Primavera y del Estudiante", hint: "Picnic, al aire libre, juntadas" },
    { day: nthWeekday(y, 10, 0, 3), name: "Día de la Madre", hint: "Agasajar a mamá sin cocinar; combos para compartir; reservá con tiempo" },
    { day: iso(y, 10, 31), name: "Halloween", hint: "Tono lúdico, estética del producto con guiño de la fecha" },
    { day: iso(y, 11, thanksgiving + 1), name: "Black Friday", hint: "Solo si hay una promo REAL cargada" },
    { day: iso(y, 12, 24), name: "Nochebuena", hint: "Quién cocina en Navidad: pedidos anticipados" },
    { day: iso(y, 12, 31), name: "Fin de año", hint: "Previa, juntadas, pedidos anticipados" },
  ].map((d) => ({ ...d, kind: "especial" as const }))
}

// ── Clima ─────────────────────────────────────────────────────────────────

/** Código WMO de Open-Meteo → texto corto. */
export function weatherText(code: number): string {
  if (code === 0) return "despejado"
  if (code <= 3) return "parcialmente nublado"
  if (code === 45 || code === 48) return "niebla"
  if (code >= 51 && code <= 57) return "llovizna"
  if (code >= 61 && code <= 67) return "lluvia"
  if (code >= 71 && code <= 77) return "nieve"
  if (code >= 80 && code <= 82) return "chaparrones"
  if (code >= 95) return "tormenta"
  return "variable"
}

/** ¿Es un día que empuja a pedir delivery? Lluvia probable, frío o calor fuerte. */
export function isDeliveryDay(w: { code: number; tmax: number | null; tmin: number | null; rain_prob: number | null }): boolean {
  const wet = (w.rain_prob ?? 0) >= 60 || (w.code >= 51 && w.code <= 67) || w.code >= 80
  const cold = w.tmax != null && w.tmax <= 11
  const hot = w.tmax != null && w.tmax >= 33
  return wet || cold || hot
}

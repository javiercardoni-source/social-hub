/**
 * Historias de feriado (pedido de Javier, 29-09-2026). Sin dependencias.
 *
 * - Feriado (o puente) en que la marca abre: dos historias seguidas ese día.
 *     1) Anuncio neutral del feriado + "en feriados conviene reservar por la alta demanda".
 *     2) "Si sos de los que se acuerdan a último momento, también te esperamos".
 * - 25/12 y 1/1 no se trabaja: una sola historia de saludo (feliz Navidad / feliz año nuevo).
 * - Si la marca no abre ese día de la semana, no se anuncia nada.
 */

export type TipoHistoria = "reserva" | "ultimo_momento" | "saludo"
export type HistoriaFeriado = { orden: number; tipo: TipoHistoria; hora: string } // hora = HH:MM de Buenos Aires

/** Con cuántos días de anticipación se arman los borradores (para que haya tiempo de aprobarlos). */
export const DIAS_ANTICIPACION = 5

export function esNavidadOAnioNuevo(day: string): "navidad" | "anio_nuevo" | null {
  const md = day.slice(5)
  return md === "12-25" ? "navidad" : md === "01-01" ? "anio_nuevo" : null
}

/** Día de la semana (0 = domingo) de una fecha YYYY-MM-DD. */
export const diaSemana = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay()

/**
 * Qué historias lleva un feriado para una marca. `abre` = días de la semana en que abre
 * (sin dato, todos). El saludo de Navidad/Año nuevo va siempre, abra o no.
 */
export function planFeriado(day: string, abre?: number[]): HistoriaFeriado[] {
  if (esNavidadOAnioNuevo(day)) return [{ orden: 1, tipo: "saludo", hora: "11:00" }]
  if (abre && !abre.includes(diaSemana(day))) return []
  // Seguidas: la segunda sale unos minutos después, para verse una detrás de la otra.
  return [
    { orden: 1, tipo: "reserva", hora: "11:30" },
    { orden: 2, tipo: "ultimo_momento", hora: "11:35" },
  ]
}

/** Clave de campaña de cada historia: evita crearla dos veces. */
export const campaniaFeriado = (day: string, orden: number) => `feriado:${day}:${orden}`

/** Fecha y hora de Buenos Aires (UTC−3 fijo) → ISO. */
export const horaBA = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-03:00`).toISOString()

/** Qué tiene que decir cada historia (se le pasa a la IA; si falla, se usa el texto de respaldo). */
export function consignaFeriado(tipo: TipoHistoria, nombre: string, day: string): { consigna: string; respaldo: string } {
  const fiesta = esNavidadOAnioNuevo(day)
  if (tipo === "saludo") {
    return fiesta === "navidad"
      ? { consigna: "Saludo de Navidad cálido y breve. No se trabaja ese día: no menciones pedidos, reservas ni horarios.", respaldo: "¡Feliz Navidad!" }
      : { consigna: "Saludo de Año nuevo cálido y breve. No se trabaja ese día: no menciones pedidos, reservas ni horarios.", respaldo: "¡Feliz año nuevo!" }
  }
  if (tipo === "reserva") {
    return {
      consigna:
        `Anunciá que hoy es feriado (${nombre}) de forma NEUTRAL: sin opinar ni explicar su significado histórico, político ni religioso. ` +
        "Recomendá reservar o pedir con anticipación porque en feriados hay mucha demanda.",
      respaldo: "Hoy es feriado: reservá con tiempo",
    }
  }
  return {
    consigna: "Segunda historia, sigue a la del feriado: tono cálido y con humor liviano, del estilo 'si sos de los que se acuerdan a último momento, también te esperamos :D'.",
    respaldo: "¿A último momento? ¡También te esperamos!",
  }
}

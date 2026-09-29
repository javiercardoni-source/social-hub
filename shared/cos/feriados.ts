/**
 * Historias de feriado (pedido de Javier, 29-09-2026). Sin dependencias.
 *
 * Las marcas trabajan con reserva y las reservas se abren 48 h antes. Cuenta regresiva
 * (día 1 = el feriado):
 *   día 5  llegan los borradores a Aprobaciones (DIAS_ANTICIPACION = 4 días antes)
 *   día 3  (48 h antes) anuncio neutral del feriado: se abren las reservas, hay mucha demanda
 *   día 2  (24 h antes) la última promocionando: último día para reservar
 *   día 1  (el feriado) "si sos de los que se acuerdan a último momento, también te esperamos :D"
 * - 25/12 y 1/1 no se trabaja: una sola historia de saludo (feliz Navidad / feliz año nuevo).
 * - Si la marca no abre ese día de la semana, no se anuncia nada.
 */

export type TipoHistoria = "reserva" | "ultima_llamada" | "ultimo_momento" | "saludo"
/** diasAntes = cuántos días antes del feriado sale; hora = HH:MM de Buenos Aires. */
export type HistoriaFeriado = { orden: number; tipo: TipoHistoria; diasAntes: number; hora: string }

/** Cuántos días antes llegan los borradores (el "día 5" de la cuenta regresiva). */
export const DIAS_ANTICIPACION = 4

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
  if (esNavidadOAnioNuevo(day)) return [{ orden: 1, tipo: "saludo", diasAntes: 0, hora: "11:00" }]
  if (abre && !abre.includes(diaSemana(day))) return []
  return [
    { orden: 1, tipo: "reserva", diasAntes: 2, hora: "11:30" },
    { orden: 2, tipo: "ultima_llamada", diasAntes: 1, hora: "11:30" },
    { orden: 3, tipo: "ultimo_momento", diasAntes: 0, hora: "11:30" },
  ]
}

/** Clave de campaña de cada historia: evita crearla dos veces. */
export const campaniaFeriado = (day: string, orden: number) => `feriado:${day}:${orden}`

/** YYYY-MM-DD menos n días. */
export function diasAntesDe(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

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
        `Faltan dos días para el feriado (${nombre}). Anuncialo de forma NEUTRAL: sin opinar ni explicar su significado histórico, ` +
        "político ni religioso. Contá que ya se pueden hacer las reservas y que conviene reservar porque en feriados hay mucha demanda.",
      respaldo: "Se viene feriado: ya podés reservar",
    }
  }
  if (tipo === "ultima_llamada") {
    return {
      consigna: `Mañana es feriado (${nombre}). Última llamada, neutral y con urgencia amable: hoy es el último día para reservar, hay mucha demanda.`,
      respaldo: "Mañana es feriado: último día para reservar",
    }
  }
  return {
    consigna: "Hoy es el feriado. Tono cálido y con humor liviano, del estilo 'si sos de los que se acuerdan a último momento, también te esperamos :D'.",
    respaldo: "¿A último momento? ¡También te esperamos!",
  }
}

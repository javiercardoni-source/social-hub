/**
 * F8 · Agenda automática — el motor que elige día y hora (puro, sin dependencias, con tests).
 *
 *   climaDeHora        el clima de una hora en las categorías que cambian el mensaje
 *   efectosContexto    cuánto pesan de verdad el feriado y el clima (aprendido, con contracción)
 *   modeloAgenda       franjas de la cuenta con "pooling" hacia el patrón de todas las cuentas
 *   esperado           rendimiento esperado de un momento (franja × feriado × clima)
 *   asignar            elige día y hora de cada pieza respetando apertura, límites y ventanas
 *   validarPropuesta   lo que proponga el agente solo se aplica si cumple las mismas reglas
 *
 * Todo en hora de Buenos Aires (UTC−3 fijo, sin horario de verano desde 2009).
 */
import { arSlot, lifts, slotModel, type Format, type PerfPost, type SlotModel } from "./timing.ts"

const HORA = 3600_000
const DIA = 24 * HORA
const AR_OFFSET = -3 * HORA
export const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"]

// ── Clima por hora ─────────────────────────────────────────────────────────

export type ClimaCat = "lluvia" | "tormenta" | "frio" | "calor" | "soleado" | "nublado"
export const CLIMAS: ClimaCat[] = ["lluvia", "tormenta", "frio", "calor", "soleado", "nublado"]
export type HoraClima = { code: number | null; temp: number | null; precip_mm?: number | null; precip_prob?: number | null }

/** Categoría del clima de UNA hora (código WMO de Open-Meteo + temperatura + lluvia). */
export function climaDeHora(h: HoraClima): ClimaCat {
  const c = h.code ?? -1
  if (c >= 95) return "tormenta"
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (h.precip_mm ?? 0) >= 0.3 || (h.precip_prob ?? 0) >= 60) return "lluvia"
  if (h.temp != null && h.temp <= 12) return "frio"
  if (h.temp != null && h.temp >= 30) return "calor"
  if (c >= 0 && c <= 1) return "soleado"
  return "nublado"
}

// ── Lo que se aprende del contexto ─────────────────────────────────────────

export type Contexto = { clima: ClimaCat | null; feriado: boolean }
export type PostCtx = PerfPost & { contexto: Contexto | null }
export type Efecto = {
  factor: "feriado" | ClimaCat
  /** Multiplicador: 1 = no cambia nada, 1,2 = +20 %. Ya contraído (poca evidencia ≈ 1). */
  efecto: number
  n: number
  /** Intervalo aproximado del 80 %. */
  lo: number
  hi: number
  confianza: "alta" | "media" | "baja"
  /** true = hay evidencia de que cambia el rendimiento. Si no, el motor no lo usa. */
  claro: boolean
}

const K_EFECTO = 8

/**
 * Efecto de cada factor de contexto, descontando lo que ya explica la franja día×hora: se mira el
 * "residuo" de cada post (su rendimiento ÷ el de su franja) y se compara el promedio (en log) de
 * los posts con ese factor contra 0, contraído hacia 0 con K_EFECTO posts imaginarios.
 */
export function efectosContexto(posts: PostCtx[], slot: SlotModel): Efecto[] {
  const L = lifts(posts)
  const res = L.map(({ post, lift }) => {
    const { dow, hour } = arSlot(post.postedAt)
    const esperado = slot.grid[dow]?.[hour] || 1
    return { r: Math.log(lift / esperado), ctx: (post as PostCtx).contexto }
  }).filter((x) => Number.isFinite(x.r) && x.ctx)
  const factores: Efecto["factor"][] = ["feriado", ...CLIMAS]
  return factores.map((factor) => {
    const grupo = res.filter((x) => (factor === "feriado" ? x.ctx!.feriado : x.ctx!.clima === factor)).map((x) => x.r)
    const n = grupo.length
    const suma = grupo.reduce((a, b) => a + b, 0)
    const media = n ? suma / (n + K_EFECTO) : 0
    const varianza = n > 1 ? grupo.reduce((a, b) => a + (b - suma / n) ** 2, 0) / (n - 1) : 0.5
    const se = Math.sqrt(varianza / (n + K_EFECTO))
    const lo = Math.exp(media - 1.28 * se)
    const hi = Math.exp(media + 1.28 * se)
    const efecto = Math.exp(media)
    const claro = n >= 8 && Math.abs(efecto - 1) >= 0.05 && (lo > 1 || hi < 1)
    const confianza = n >= 40 ? "alta" : n >= 15 ? "media" : "baja"
    return { factor, efecto: round(efecto), n, lo: round(lo), hi: round(hi), confianza, claro }
  })
}

// ── Modelo con pooling ─────────────────────────────────────────────────────

export type ModeloAgenda = { slot: SlotModel; efectos: Efecto[]; n: number; nPool: number; peso: number }

/**
 * Modelo de una cuenta y formato. Con poca historia propia se apoya en el patrón de todas las
 * cuentas (pooling): peso propio = n / (n + 30). FasutoFudo (23 reels) queda ~40 % propio.
 */
export function modeloAgenda(propios: PostCtx[], todos: PostCtx[], feriados?: Set<string>): ModeloAgenda {
  const propio = slotModel(propios, 3, feriados)
  const pool = slotModel(todos, 3, feriados)
  const peso = propio.n / (propio.n + 30)
  const mezcla = (a: number, b: number) => peso * a + (1 - peso) * b
  const slot: SlotModel = {
    n: propio.n,
    grid: propio.grid.map((fila, d) => fila.map((v, h) => mezcla(v, pool.grid[d][h]))),
    count: propio.count,
    hour: propio.hour.map((v, h) => mezcla(v, pool.hour[h])),
    day: propio.day.map((v, d) => mezcla(v, pool.day[d])),
    // La evidencia por hora es SOLO la propia: define qué se explora y cuándo se avisa "poca data".
    // (Sumar la de otras cuentas hacía que Bijutsukan, que siempre publicó a las 20, casi nunca explorara.)
    hourN: propio.hourN,
  }
  // Los efectos de contexto se aprenden con todo (son de la ciudad, no de la cuenta).
  return { slot, efectos: efectosContexto(todos, pool), n: propio.n, nPool: pool.n, peso: round(peso) }
}

/** Rendimiento esperado en un momento: franja × feriado × clima (solo los efectos claros). */
export function esperado(m: ModeloAgenda, at: Date, ctx: Contexto | null, feriados?: Set<string>): { lift: number; por: string[] } {
  const { dow, hour } = arSlot(at, feriados)
  let lift = m.slot.grid[dow]?.[hour] ?? 1
  const por: string[] = []
  if (ctx?.feriado) {
    const e = m.efectos.find((x) => x.factor === "feriado")
    if (e?.claro) {
      lift *= e.efecto
      por.push(`feriado ${pct(e.efecto)}`)
    }
  }
  if (ctx?.clima) {
    const e = m.efectos.find((x) => x.factor === ctx.clima)
    if (e?.claro) {
      lift *= e.efecto
      por.push(`${ctx.clima === "lluvia" || ctx.clima === "tormenta" ? "llueve" : ctx.clima} ${pct(e.efecto)}`)
    }
  }
  return { lift: round(lift), por }
}

// ── Apertura ───────────────────────────────────────────────────────────────

/** { "0": [{desde:"19:00", hasta:"23:30"}], … } (0 = domingo). null = sin dato. */
export type Apertura = Record<string, { desde: string; hasta: string }[]>

const hhmm = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Deja la apertura válida (horas bien escritas, días 0-6). Lo que no se entiende se descarta. */
export function normalizarApertura(raw: unknown): Apertura | null {
  if (!raw || typeof raw !== "object") return null
  const out: Apertura = {}
  for (let d = 0; d < 7; d++) {
    const turnos = (raw as Record<string, unknown>)[String(d)]
    out[String(d)] = Array.isArray(turnos)
      ? turnos
          .map((t) => t as { desde?: unknown; hasta?: unknown })
          .filter((t) => typeof t.desde === "string" && typeof t.hasta === "string" && hhmm(t.desde) != null && hhmm(t.hasta) != null)
          .map((t) => ({ desde: (t.desde as string).trim().padStart(5, "0"), hasta: (t.hasta as string).trim().padStart(5, "0") }))
      : []
  }
  return Object.values(out).some((t) => t.length) ? out : null
}

/** ¿Abre ese día de la semana? Sin dato de apertura: se usan los días del texto viejo, o todos. */
export function abreEseDia(ap: Apertura | null, dow: number, diasTexto?: number[]): boolean {
  if (ap) return (ap[String(dow)] ?? []).length > 0
  return !diasTexto || diasTexto.includes(dow)
}

/** Minutos desde medianoche en que empieza el primer turno del día (null si no abre). */
export function primerTurno(ap: Apertura | null, dow: number): number | null {
  const turnos = ap?.[String(dow)] ?? []
  const mins = turnos.map((t) => hhmm(t.desde)).filter((x): x is number => x != null)
  return mins.length ? Math.min(...mins) : null
}

// ── Asignación ─────────────────────────────────────────────────────────────

export type Formato = Format // feed | reel | story | carousel | video
export type Pieza = {
  id: string
  account: string
  format: Formato
  /** Día fijo (YYYY-MM-DD, Buenos Aires): feriados y clima. */
  dia?: string
  /** Tiene que salir antes de este momento (fecha especial, promo que vence). */
  antesDe?: string
  /** Solo antes de que abra el local ese día (historias de clima: el aviso va antes del servicio). */
  antesDelServicio?: boolean
  /** Ya programada y aprobada con ventana: solo se puede mover dentro de ella y lejos de ahora. */
  ventana?: { desde: string; hasta: string }
  /** Hora actual (si ya tenía). */
  actual?: string | null
  /**
   * Historia de una subida: va DESPUÉS del reel/post de Instagram de la misma subida (1 a 3 h), así
   * no compiten y la historia recuerda lo que ya está en el feed. `despuesDe` = id de ese post si
   * también lo ubica el motor; `despuesDeAt` = su hora si ya está fijo.
   */
  despuesDe?: string
  despuesDeAt?: string
  /** Cuándo se creó: con 3 meses de agenda, lo más viejo sale primero. */
  creada?: string
}
export type Ocupado = { account: string; format: Formato; at: string }
export type Asignacion = {
  id: string
  at: string
  ventana: { desde: string; hasta: string }
  fuente: "motor" | "exploracion" | "fijo"
  lift: number
  porque: string
}
export type Reglas = {
  desde: Date
  /** Días hacia adelante para lo que no tiene día (decisión: 7). */
  dias: number
  horaMin: number // 9
  horaMax: number // 22
  apertura: Apertura | null
  diasTexto?: number[]
  feriados?: Set<string>
  /** Clima pronosticado por hora (clave = ISO de la hora en UTC). */
  clima?: Map<string, ClimaCat>
  /** 1 de cada N piezas a una franja con poca historia (decisión: 6). 0 = sin exploración. */
  explorarCada: number
  /** Ritmo de la cuenta (cos_brands.ritmo). Sin dato: el de siempre (1 post/día, 5 historias/día). */
  ritmo?: Ritmo
}

/**
 * Ritmo de publicación de cada cuenta de la marca (07-10-2026, Javier: "5 por semana"). La agenda
 * llena en orden, semana por semana, y dentro de cada semana elige los mejores días y horas.
 */
export type Ritmo = { postsSemana: number; historiasDia: number }
export const RITMO_DEFAULT: Ritmo = { postsSemana: 5, historiasDia: 3 }
/** Días hacia adelante que mira la agenda (07-10-2026: de 7 a 90, una temporada). */
export const HORIZONTE_DIAS = 90

export function leerRitmo(x: unknown): Ritmo {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
  const n = (v: unknown, def: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(1, Math.round(v))) : def)
  return { postsSemana: n(o.postsSemana, RITMO_DEFAULT.postsSemana, 14), historiasDia: n(o.historiasDia, RITMO_DEFAULT.historiasDia, 5) }
}

export const LIMITES = {
  post: { porDia: 1, separacionMin: 4 * 60 },
  story: { porDia: 5, separacionMin: 90 },
}
/** Límites de una cuenta con su ritmo: posts 1 por día y N por semana; historias N por día. */
function limitesDe(ritmo?: Ritmo) {
  return {
    post: { porDia: ritmo && ritmo.postsSemana > 7 ? 2 : 1, porSemana: ritmo?.postsSemana ?? 99, separacionMin: 4 * 60 },
    story: { porDia: ritmo?.historiasDia ?? LIMITES.story.porDia, porSemana: 99, separacionMin: 90 },
  }
}
const tipo = (f: Formato) => (f === "story" ? "story" : "post")

/** Semana de Buenos Aires (lunes YYYY-MM-DD) de un instante. */
export function semanaBA(at: Date): string {
  const { dia, dow } = enBA(at)
  return sumarDias(dia, -((dow + 6) % 7))
}

/** Fecha YYYY-MM-DD y hora en Buenos Aires de un instante. */
export function enBA(at: Date): { dia: string; dow: number; min: number } {
  const t = new Date(at.getTime() + AR_OFFSET)
  return { dia: t.toISOString().slice(0, 10), dow: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes() }
}
/** Instante de una fecha (YYYY-MM-DD) y minutos de Buenos Aires. */
export function deBA(dia: string, min: number): Date {
  return new Date(Date.parse(`${dia}T00:00:00Z`) - AR_OFFSET + min * 60_000)
}
const sumarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10)

/** ¿Se puede poner esta pieza en `at`, dadas las ya puestas? (límites por cuenta, apertura, horario) */
export function cabe(p: Pieza, at: Date, ocupados: Ocupado[], r: Reglas): string | null {
  const { dia, dow, min } = enBA(at)
  if (min < r.horaMin * 60 || min > r.horaMax * 60) return `fuera de ${r.horaMin}–${r.horaMax} h`
  if (!abreEseDia(r.apertura, dow, r.diasTexto)) return "la marca no abre ese día"
  if (p.antesDelServicio) {
    const abre = primerTurno(r.apertura, dow)
    if (abre != null && min > abre - 60) return "tiene que salir antes del servicio"
  }
  if (p.dia && dia !== p.dia) return "no es su día"
  if (p.antesDe && at.getTime() > Date.parse(p.antesDe)) return "después de su fecha límite"
  if (p.ventana && (at.getTime() < Date.parse(p.ventana.desde) || at.getTime() > Date.parse(p.ventana.hasta))) return "fuera de su ventana aprobada"
  return chocaConReglas(p, at, ocupados, r.ritmo)
}

/**
 * Freno anti-ráfaga para lo que se aprueba A MANO ("apenas apruebe" u otra hora): la hora la elige
 * Javier, pero dos piezas de la misma cuenta no salen más cerca que lo que pide la agenda
 * (4 h entre feed/reels, 90 min entre historias). Si choca, se corre al primer hueco hacia adelante.
 * No mira apertura ni horario: eso es decisión de quien la fijó. (30-09-2026: se aprobaron 9 piezas
 * de FasutoFudo con la agenda apagada y salieron las 9 en un minuto.)
 */
/** Cuánto después de su reel/post sale la historia de la misma subida. */
export const HISTORIA_DESPUES = { minimoMin: 60, idealMin: 90, maximoMin: 180 }

/**
 * Hora para la historia de una subida aprobada a mano: si cae a menos de 1 h de su reel/post de
 * Instagram (antes o después), se corre a 90 min después de él.
 */
export function horaHistoriaManual(deseado: Date, anclas: Date[]): { at: Date; corrida: boolean } {
  const cerca = anclas.filter((a) => Math.abs(deseado.getTime() - a.getTime()) < HISTORIA_DESPUES.minimoMin * 60_000).sort((a, b) => b.getTime() - a.getTime())[0]
  if (!cerca) return { at: deseado, corrida: false }
  return { at: new Date(cerca.getTime() + HISTORIA_DESPUES.idealMin * 60_000), corrida: true }
}

export function primerHuecoManual(p: { account: string; format: Formato }, deseado: Date, ocupados: Ocupado[]): { at: Date; corrido: boolean } {
  const sep = LIMITES[tipo(p.format)].separacionMin * 60_000
  const mismos = ocupados
    .filter((o) => o.account === p.account && tipo(o.format) === tipo(p.format))
    .map((o) => Date.parse(o.at))
    .sort((a, b) => a - b)
  let t = deseado.getTime()
  // Cada choque empuja a "la otra + separación"; como la lista está ordenada, alcanza con barrerla.
  for (let vuelta = 0; vuelta < 2 * mismos.length + 1; vuelta++) {
    const choque = mismos.find((o) => Math.abs(o - t) < sep)
    if (choque == null) break
    t = choque + sep
  }
  return { at: new Date(t), corrido: t !== deseado.getTime() }
}

/**
 * ¿Choca esta hora con lo ya aprobado de la misma cuenta? Mismas reglas que la agenda: separación
 * (4 h entre posts/reels, 90 min entre historias) y máximo por día (1 post/reel, 5 historias).
 * Devuelve el motivo o null. (07-10-2026: aprobar «en el horario de la agenda» no lo verificaba y
 * salieron 3 reels de Bijutsukan juntos a las 19:00.)
 */
export function chocaConReglas(p: { account: string; format: Formato }, at: Date, ocupados: Ocupado[], ritmo?: Ritmo): string | null {
  const lim = limitesDe(ritmo)[tipo(p.format)]
  const mismos = ocupados.filter((o) => o.account === p.account && tipo(o.format) === tipo(p.format))
  const t = at.getTime()
  if (mismos.some((o) => Math.abs(Date.parse(o.at) - t) < lim.separacionMin * 60_000)) return "muy cerca de otra pieza de la cuenta"
  const dia = enBA(at).dia
  if (mismos.filter((o) => diaDe(o.at) === dia).length >= lim.porDia) return `ya hay ${lim.porDia === 1 ? (tipo(p.format) === "story" ? "una historia" : "un post") : `${lim.porDia}`} ese día`
  if (lim.porSemana < 99) {
    const sem = semanaBA(at)
    if (mismos.filter((o) => semanaDe(o.at) === sem).length >= lim.porSemana) return `ya hay ${lim.porSemana} esa semana`
  }
  return null
}
// Día y semana de cada ocupado, cacheados: con 3 meses de agenda se consultan miles de veces.
const cacheDia = new Map<string, string>()
const cacheSemana = new Map<string, string>()
function diaDe(iso: string): string {
  let d = cacheDia.get(iso)
  if (!d) cacheDia.set(iso, (d = enBA(new Date(iso)).dia))
  return d
}
function semanaDe(iso: string): string {
  let d = cacheSemana.get(iso)
  if (!d) cacheSemana.set(iso, (d = semanaBA(new Date(iso))))
  return d
}

/**
 * Hora final de algo aprobado a mano: la pedida si cumple las reglas de la cuenta; si no, el primer
 * hueco hacia adelante que las cumpla, DENTRO del horario (9 a 22). `horaElegida` = Javier eligió esa
 * hora puntual: se respeta aunque esté fuera de horario, siempre que no choque.
 * (07-10-2026: el freno viejo solo separaba de a 4 h y apiló 148 piezas de FasutoFudo día y noche.)
 */
export function huecoConReglas(
  p: { account: string; format: Formato },
  deseado: Date,
  ocupados: Ocupado[],
  opts: { horaElegida?: boolean; horaMin?: number; horaMax?: number; ritmo?: Ritmo } = {},
): { at: Date; corrido: boolean } {
  const horaMin = (opts.horaMin ?? 9) * 60
  const horaMax = (opts.horaMax ?? 22) * 60
  const enHorario = (t: Date) => {
    const m = enBA(t).min
    return m >= horaMin && m <= horaMax
  }
  if (!chocaConReglas(p, deseado, ocupados, opts.ritmo) && (opts.horaElegida || enHorario(deseado))) return { at: deseado, corrido: false }
  // Barrido de a 15 min (redondeado), saltando la noche, hasta 120 días.
  let t = new Date(Math.ceil(deseado.getTime() / (15 * 60_000)) * 15 * 60_000)
  const fin = deseado.getTime() + 120 * DIA
  while (t.getTime() <= fin) {
    const { dia, min } = enBA(t)
    if (min < horaMin) t = deBA(dia, horaMin)
    else if (min > horaMax) t = deBA(sumarDias(dia, 1), horaMin)
    else if (!chocaConReglas(p, t, ocupados, opts.ritmo)) return { at: t, corrido: true }
    else t = new Date(t.getTime() + 15 * 60_000)
  }
  return { at: t, corrido: true }
}

/** Semilla estable por pieza (para que la exploración no cambie en cada corrida). */
function semilla(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return (h >>> 0) % 1000
}

/** Candidatos cada 30 min entre dos instantes (dentro del horario). */
function candidatosEntre(desde: Date, hasta: Date, r: Reglas): Date[] {
  const out: Date[] = []
  for (let dia = enBA(desde).dia; deBA(dia, 0).getTime() <= hasta.getTime(); dia = sumarDias(dia, 1)) {
    for (let min = r.horaMin * 60; min <= r.horaMax * 60; min += 30) {
      const at = deBA(dia, min)
      if (at.getTime() >= desde.getTime() && at.getTime() <= hasta.getTime()) out.push(at)
    }
  }
  return out
}

/**
 * Elige día y hora para cada pieza. Primero las más restringidas (día fijo, fecha límite, ventana),
 * después el resto. Las que ya están ocupadas (fijadas a mano, publicándose) cuentan para los límites.
 * Una de cada `explorarCada` piezas sin día fijo va a una franja con poca historia (🧪), para que el
 * motor no se encierre en lo primero que funcionó.
 */
export function asignar(piezas: Pieza[], m: (p: Pieza) => ModeloAgenda, ocupados: Ocupado[], r: Reglas): { asignadas: Asignacion[]; sinLugar: { id: string; motivo: string }[] } {
  // Primero las más restringidas; entre iguales, la más vieja (con 3 meses de agenda, el orden importa).
  const orden = [...piezas].sort((a, b) => rigidez(b) - rigidez(a) || (a.creada ?? "").localeCompare(b.creada ?? "") || a.id.localeCompare(b.id))
  const puestas: Ocupado[] = [...ocupados]
  // Lo aprobado que ya tiene hora la reserva desde el principio: si después no se le encuentra otro
  // lugar se queda donde está, y nadie puede caer en ese horario. (07-10-2026: dos piezas de la misma
  // cuenta quedaron a la misma hora exacta porque la que no tenía lugar seguía en su hora vieja sin
  // reservarla, y la otra la tomó como libre.)
  const reservas = new Map<string, Ocupado>()
  for (const p of piezas) if (p.ventana && p.actual) reservas.set(p.id, { account: p.account, format: p.format, at: p.actual })
  puestas.push(...reservas.values())
  const asignadas: Asignacion[] = []
  const sinLugar: { id: string; motivo: string }[] = []
  // Hasta el final del último día del horizonte (dias = 0: solo hoy).
  const horizonte = deBA(sumarDias(enBA(r.desde).dia, r.dias), 24 * 60 - 1)
  for (const p of orden) {
    // Lo aprobado con ventana se mueve solo lejos de ahora (3 h). Lo pendiente, desde dentro de 2 h: la
    // agenda corre cada hora, así un borrador nunca queda con su hora vencida (el reloj lo vencería).
    const minimo = new Date(r.desde.getTime() + (p.ventana ? 3 : 2) * HORA)
    // Su propia hora actual no le estorba (puede quedarse o moverse).
    const reserva = reservas.get(p.id)
    if (reserva) puestas.splice(puestas.indexOf(reserva), 1)
    const modelo = m(p)
    const evaluar = (cands: Date[]) =>
      cands
        .filter((at) => !cabe(p, at, puestas, r))
        .map((at) => {
          const horaUtc = new Date(Math.floor(at.getTime() / HORA) * HORA).toISOString()
          const ctx: Contexto = { clima: r.clima?.get(horaUtc) ?? null, feriado: !!r.feriados?.has(enBA(at).dia) }
          const e = esperado(modelo, at, ctx, r.feriados)
          return { at, ...e, evidencia: modelo.slot.hourN[(enBA(at).min / 60) | 0] ?? 0 }
        })
    // Historia de una subida: de 1 a 3 h después de su reel/post (si hay lugar; si no, donde quepa, pero nunca antes).
    const ancla = p.despuesDeAt ?? (p.despuesDe ? asignadas.find((a) => a.id === p.despuesDe)?.at : undefined)
    let opciones: ReturnType<typeof evaluar> = []
    if (p.dia) {
      opciones = evaluar(candidatosEntre(new Date(Math.max(minimo.getTime(), deBA(p.dia, 0).getTime())), deBA(p.dia, 24 * 60 - 1), r))
    } else if (ancla) {
      const a = Date.parse(ancla)
      const desdeAncla = new Date(Math.max(minimo.getTime(), a + HISTORIA_DESPUES.minimoMin * 60_000))
      opciones = evaluar(candidatosEntre(desdeAncla, new Date(a + HISTORIA_DESPUES.maximoMin * 60_000), r))
      for (let d = desdeAncla; !opciones.length && d.getTime() < horizonte.getTime(); d = new Date(d.getTime() + 7 * DIA)) {
        opciones = evaluar(candidatosEntre(d, new Date(Math.min(horizonte.getTime(), d.getTime() + 7 * DIA)), r))
      }
    } else {
      // Semana por semana desde hoy: la primera semana con lugar (respetando el ritmo), y dentro de
      // ella el mejor día y hora. Así se llena en orden, sin dejar semanas vacías por esperar el mejor jueves.
      const desde = p.ventana ? new Date(Math.max(minimo.getTime(), Date.parse(p.ventana.desde))) : minimo
      const hasta = p.ventana ? new Date(Math.min(horizonte.getTime(), Date.parse(p.ventana.hasta))) : horizonte
      for (let d = desde; !opciones.length && d.getTime() <= hasta.getTime(); ) {
        const lunes = deBA(sumarDias(semanaBA(d), 7), 0)
        const fin = new Date(Math.min(hasta.getTime(), lunes.getTime() - 1))
        opciones = evaluar(candidatosEntre(d, fin, r))
        d = lunes
      }
    }
    if (!opciones.length) {
      // Se queda en su hora: el horario sigue reservado para que nadie caiga encima.
      if (reserva) puestas.push(reserva)
      sinLugar.push({ id: p.id, motivo: p.ventana ? "no hay lugar dentro de su ventana" : `no hay horario libre en los próximos ${r.dias} días con el ritmo de la cuenta` })
      continue
    }
    const explorar = !p.dia && !p.ventana && r.explorarCada > 0 && semilla(p.id) % r.explorarCada === 0
    let elegido = opciones.reduce((a, b) => (b.lift > a.lift ? b : a))
    let fuente: Asignacion["fuente"] = p.dia ? "fijo" : "motor"
    if (explorar) {
      // Franjas con poca historia, entre las que no son malas del todo.
      const poca = opciones.filter((o) => o.evidencia <= 1 && o.lift >= 0.85)
      if (poca.length) {
        elegido = poca[semilla(p.id + ":franja") % poca.length]
        fuente = "exploracion"
      }
    }
    // Si ya tenía una hora y rinde casi igual (±3 %), no se mueve: menos cambios, menos ruido.
    if (p.actual && !explorar) {
      const actual = opciones.find((o) => o.at.getTime() === Date.parse(p.actual!))
      if (actual && actual.lift >= elegido.lift * 0.97) elegido = actual
    }
    const at = elegido.at
    puestas.push({ account: p.account, format: p.format, at: at.toISOString() })
    // Confianza (mismos umbrales que timing.ts): con poca evidencia se dice en el porqué.
    const poca = !(modelo.n >= 15 && elegido.evidencia >= 3)
    asignadas.push({ id: p.id, at: at.toISOString(), ventana: p.ventana ?? ventanaPara(p, at, r), fuente, lift: elegido.lift, porque: porque(at, p, elegido.lift, elegido.por, fuente) + (poca && fuente === "motor" ? " · poca data" : "") })
  }
  return { asignadas, sinLugar }
}

function rigidez(p: Pieza): number {
  // Las historias que dependen de su reel/post van después de él (cuando ya tiene hora).
  return (p.despuesDe ? -100 : 0) + (p.dia ? 8 : 0) + (p.antesDelServicio ? 4 : 0) + (p.ventana ? 2 : 0) + (p.antesDe ? 1 : 0)
}

/**
 * La ventana que se aprueba junto con el contenido: el día elegido y el siguiente (de horaMin a
 * horaMax), o el día fijo. El motor puede reacomodar dentro de ella si cambia el pronóstico.
 */
export function ventanaPara(p: Pieza, at: Date, r: Reglas): { desde: string; hasta: string } {
  const { dia } = enBA(at)
  if (p.dia) return { desde: deBA(p.dia, r.horaMin * 60).toISOString(), hasta: deBA(p.dia, r.horaMax * 60).toISOString() }
  let hasta = deBA(sumarDias(dia, 1), r.horaMax * 60)
  if (p.antesDe && hasta.getTime() > Date.parse(p.antesDe)) hasta = new Date(Date.parse(p.antesDe))
  if (hasta.getTime() <= at.getTime()) hasta = new Date(at.getTime() + 30 * 60_000)
  const desde = deBA(dia, r.horaMin * 60)
  return { desde: (desde.getTime() < at.getTime() ? desde : at).toISOString(), hasta: hasta.toISOString() }
}

/** "jue 19:30 · reel · +28 % sobre tu promedio · llueve +12 %" */
function porque(at: Date, p: Pieza, lift: number, por: string[], fuente: Asignacion["fuente"]): string {
  const { dow, min } = enBA(at)
  const hora = `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`
  const base = `${DIAS_CORTOS[dow]} ${hora} · ${p.format === "story" ? "historia" : p.format}`
  if (fuente === "exploracion") return `${base} · 🧪 probando un horario con poca historia`
  return [base, `${pct(lift)} sobre tu promedio`, ...por].join(" · ")
}

// ── Lo que propone el agente ───────────────────────────────────────────────

export type Propuesta = { post_id: string; at: string; porque?: string }

/**
 * Aplica solo las propuestas del agente que cumplen las MISMAS reglas que el asignador (y respetan
 * lo demás ya puesto). Devuelve el plan final y lo descartado con el motivo.
 */
export function validarPropuesta(
  propuestas: Propuesta[],
  base: Asignacion[],
  piezas: Pieza[],
  ocupados: Ocupado[],
  r: Reglas,
): { plan: Asignacion[]; descartadas: { post_id: string; motivo: string }[] } {
  const plan = new Map(base.map((a) => [a.id, a]))
  const descartadas: { post_id: string; motivo: string }[] = []
  for (const pr of propuestas) {
    const p = piezas.find((x) => x.id === pr.post_id)
    const at = new Date(pr.at)
    if (!p) {
      descartadas.push({ post_id: pr.post_id, motivo: "no es una pieza de esta agenda" })
      continue
    }
    if (Number.isNaN(at.getTime())) {
      descartadas.push({ post_id: pr.post_id, motivo: "fecha inválida" })
      continue
    }
    const minimo = r.desde.getTime() + (p.ventana ? 3 : 2) * HORA
    if (at.getTime() < minimo) {
      descartadas.push({ post_id: pr.post_id, motivo: p.ventana ? "a menos de 3 h" : "en el pasado o demasiado pronto" })
      continue
    }
    const otros: Ocupado[] = [
      ...ocupados,
      ...[...plan.values()].filter((a) => a.id !== p.id).map((a) => ({ account: piezas.find((x) => x.id === a.id)?.account ?? "", format: piezas.find((x) => x.id === a.id)?.format ?? "feed", at: a.at })),
    ]
    const motivo = cabe(p, at, otros, r)
    if (motivo) {
      descartadas.push({ post_id: pr.post_id, motivo })
      continue
    }
    const previo = plan.get(p.id)
    plan.set(p.id, {
      id: p.id,
      at: at.toISOString(),
      ventana: p.ventana ?? ventanaPara(p, at, r),
      fuente: p.dia ? "fijo" : "motor",
      lift: previo?.lift ?? 1,
      porque: `${pr.porque?.trim().slice(0, 160) || "propuesto por el agente"}`,
    })
  }
  return { plan: [...plan.values()], descartadas }
}

// ── utilidades ─────────────────────────────────────────────────────────────

const round = (x: number) => Math.round(x * 1000) / 1000
/** "+28 %" / "−12 %" / "como siempre" */
export function pct(lift: number): string {
  const p = Math.round((lift - 1) * 100)
  if (Math.abs(p) < 3) return "como siempre"
  return `${p > 0 ? "+" : "−"}${Math.abs(p)} %`
}

// ── Historias de clima ─────────────────────────────────────────────────────

type Consigna = { consigna: string; respaldo: string }
export const CONSIGNAS_CLIMA: Record<"lluvia" | "tormenta" | "soleado" | "frio" | "calor", Consigna> = {
  lluvia: {
    consigna:
      "Hoy llueve. Aviso honesto y amable: en días de lluvia la demora puede ser un poco mayor por la calzada mojada. " +
      "Sin dramatizar y sin prometer tiempos; invitá a pedir con un poco de anticipación.",
    respaldo: "Llueve: pedí con un poco de tiempo",
  },
  tormenta: {
    consigna:
      "Hoy hay tormenta. Aviso cuidadoso: con la calzada mojada la demora puede ser mayor y cuidamos a quienes reparten. " +
      "Sin dramatizar ni prometer tiempos; invitá a pedir con anticipación.",
    respaldo: "Tormenta: pedí con tiempo",
  },
  soleado: { consigna: "Hoy es un día lindo y soleado. Historia alegre, con buena onda, para disfrutar el día (sin prometer nada).", respaldo: "¡Qué lindo día!" },
  frio: { consigna: "Hoy hace frío. Plan de quedarse en casa, calentito, y pedir (sin prometer tiempos).", respaldo: "Hace frío: plan en casa" },
  calor: { consigna: "Hoy hace mucho calor. Algo fresco sin moverse de casa (sin prometer tiempos).", respaldo: "Calor: quedate fresco en casa" },
}

/**
 * Qué historia de clima corresponde a un día (decisión de Javier, 30-09):
 *   lluvia / tormenta → siempre (es información útil: la demora puede ser mayor)
 *   sol / frío / calor → solo si cambió respecto del día anterior (el segundo día de sol no es noticia)
 *   nublado → nada
 */
export function historiaDeClima(hoy: ClimaCat | null, ayer: ClimaCat | null): keyof typeof CONSIGNAS_CLIMA | null {
  if (hoy === "lluvia" || hoy === "tormenta") return hoy
  if (hoy === "soleado" || hoy === "frio" || hoy === "calor") return hoy !== ayer ? hoy : null
  return null
}


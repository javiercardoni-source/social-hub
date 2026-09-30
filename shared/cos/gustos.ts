/**
 * F7 Motor de gustos — vocabulario cerrado y fichas (M0).
 *
 * Una sola fuente para la web, el worker y la base: los CHECK de la migración 0018 repiten
 * estas listas y un test verifica que sean idénticas. Vocabulario cerrado = "cenital" y "vista
 * desde arriba" cuentan como lo mismo, y el motor puede sumar posts por rasgo.
 *
 * Sin dependencias y sin sintaxis exclusiva de TypeScript: lo usan la web, el worker y los tests.
 */

// ── Música ─────────────────────────────────────────────────────────────────

export const GENEROS = ["house", "jazz", "lounge", "lofi", "urbano", "oriental", "pop", "otro"] as const
export type Genero = (typeof GENEROS)[number]
export const GENERO_LABEL: Record<Genero, string> = {
  house: "House",
  jazz: "Jazz",
  lounge: "Lounge",
  lofi: "Lo-fi",
  urbano: "Urbano",
  oriental: "Oriental",
  pop: "Pop",
  otro: "Otro",
}

export const MOODS = ["relajado", "arriba", "elegante", "divertido", "romantico"] as const
export type Mood = (typeof MOODS)[number]
export const MOOD_LABEL: Record<Mood, string> = {
  relajado: "Relajado",
  arriba: "Arriba",
  elegante: "Elegante",
  divertido: "Divertido",
  romantico: "Romántico",
}

/** Etiquetas que se cargan a mano con chips. `vocals`: true = con voz, false = instrumental, null = sin marcar. */
export type EtiquetasTema = { genre: Genero | null; mood: Mood[]; vocals: boolean | null }

const esDe = <T extends string>(lista: readonly T[], v: unknown): v is T => typeof v === "string" && (lista as readonly string[]).includes(v)

/** Deja solo lo que está en el vocabulario (lo demás se descarta, no se corrige). */
export function normalizarEtiquetas(raw: unknown): EtiquetasTema {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const mood = Array.isArray(r.mood) ? [...new Set(r.mood.filter((m): m is Mood => esDe(MOODS, m)))] : []
  return {
    genre: esDe(GENEROS, r.genre) ? r.genre : null,
    mood: MOODS.filter((m) => mood.includes(m)), // orden estable
    vocals: typeof r.vocals === "boolean" ? r.vocals : null,
  }
}

/** Nombre legible de un tema a partir de su ruta en el bucket (sin el sufijo aleatorio de la subida). */
export function tituloTema(storageKey: string): string {
  return (
    (storageKey.split("/").pop() ?? storageKey)
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+[0-9a-f]{6}$/i, "")
      .trim() || "tema"
  )
}

/** Ruta válida de la biblioteca de una marca: music/<slug>/<archivo>.<mp3|m4a|wav|aac>. */
export function esRutaDeMusica(key: string, slug?: string): boolean {
  if (key.includes("..")) return false
  const m = key.match(/^music\/([a-z0-9-]+)\/[^/]+\.(mp3|m4a|wav|aac)$/i)
  return !!m && (slug === undefined || m[1] === slug)
}

/**
 * Energía 0-1 a partir del RMS del tema en dBFS. Un tema masterizado suele andar entre −18 y −8 dB:
 * −30 dB o menos = 0 (muy tranquilo), −6 dB o más = 1 (muy fuerte).
 */
export function energiaDesdeRms(rmsDb: number): number {
  if (!Number.isFinite(rmsDb)) return 0
  return Math.round(Math.min(1, Math.max(0, (rmsDb + 30) / 24)) * 100) / 100
}

// ── Análisis de audio (puro: el worker decodifica con ffmpeg y le pasa las muestras) ──

export type AnalisisAudio = {
  /** Pulsos por minuto; null si el ritmo no es claro (mejor null que un número inventado). */
  bpm: number | null
  /** 0-1: qué tan marcado es el pulso encontrado. */
  bpmConfianza: number
  rmsDb: number
  energy: number
}

/** Por debajo de esta confianza el BPM no se informa. */
export const BPM_CONFIANZA_MIN = 0.12
const BPM_MIN = 60
const BPM_MAX = 180

/**
 * BPM por autocorrelación de la envolvente de ataques (onsets) + energía por RMS.
 * `samples` = audio mono en float [-1, 1] a `sr` Hz (el worker usa 11.025 Hz, hasta 2 minutos).
 */
export function analizarAudio(samples: Float32Array, sr: number): AnalisisAudio {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  const rms = samples.length ? Math.sqrt(sum / samples.length) : 0
  const rmsDb = rms > 0 ? Math.round(20 * Math.log10(rms) * 10) / 10 : -120
  const energy = energiaDesdeRms(rmsDb)

  // Envolvente: energía por ventana de 256 muestras (≈ 23 ms a 11 kHz), en log, y su subida
  // (solo lo que crece = un ataque: golpe, nota nueva).
  const hop = 256
  const frames = Math.floor(samples.length / hop)
  const fps = sr / hop
  if (frames < fps * 6 || rms === 0) return { bpm: null, bpmConfianza: 0, rmsDb, energy }
  const e = new Float64Array(frames)
  for (let f = 0; f < frames; f++) {
    let s = 0
    for (let i = f * hop; i < (f + 1) * hop; i++) s += samples[i] * samples[i]
    e[f] = Math.log(1e-9 + s)
  }
  const flux = new Float64Array(frames)
  let mean = 0
  for (let f = 1; f < frames; f++) {
    flux[f] = Math.max(0, e[f] - e[f - 1])
    mean += flux[f]
  }
  mean /= frames
  for (let f = 0; f < frames; f++) flux[f] -= mean
  // Suavizado triangular: un pulso que cae entre dos ventanas no parte su pico en dos.
  const liso = new Float64Array(frames)
  for (let f = 0; f < frames; f++) {
    let s = 0
    let w = 0
    for (let k = -2; k <= 2; k++) {
      if (f + k < 0 || f + k >= frames) continue
      const peso = 3 - Math.abs(k)
      s += flux[f + k] * peso
      w += peso
    }
    liso[f] = s / w
  }
  flux.set(liso)

  const ac = (lag: number) => {
    let s = 0
    for (let f = lag; f < frames; f++) s += flux[f] * flux[f - lag]
    return s / (frames - lag)
  }
  const ac0 = ac(0)
  if (ac0 <= 0) return { bpm: null, bpmConfianza: 0, rmsDb, energy }

  // Autocorrelación hasta 4 compases de pulso lento (para el "peine" de abajo).
  const maxLag = Math.ceil((60 * fps) / BPM_MIN) * 4 + 2
  const vals: number[] = []
  for (let lag = 0; lag <= Math.min(maxLag, frames - 2); lag++) vals.push(ac(lag))
  const en = (x: number) => {
    const i = Math.floor(x)
    if (i + 1 >= vals.length) return 0
    const t = x - i
    return vals[i] * (1 - t) + vals[i + 1] * t
  }

  // Barrido fino de tempos. Cada uno suma su pulso, el de 2 y el de 4 ("peine"): en música en 4/4
  // eso descarta leer la mitad, el doble o 2/3 del tempo real. Preferencia suave por tempos cercanos
  // a 120. Calibrado el 30-09-2026 con los 20 temas de la biblioteca: todos entre 115 y 136.
  const prior = (bpm: number) => Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.7) ** 2)
  let bpmCrudo = 0
  let mejor = -Infinity
  for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += 0.5) {
    const L = (60 * fps) / bpm
    const score = (en(L) + 0.5 * en(2 * L) + 0.25 * en(4 * L)) * prior(bpm)
    if (score > mejor) {
      mejor = score
      bpmCrudo = bpm
    }
  }
  const confianza = Math.round(Math.min(1, Math.max(0, en((60 * fps) / bpmCrudo) / ac0)) * 100) / 100
  const bpm = confianza >= BPM_CONFIANZA_MIN ? Math.round(bpmCrudo) : null
  return { bpm, bpmConfianza: confianza, rmsDb, energy }
}

// ── Rasgos de imagen / video ───────────────────────────────────────────────

/** Sube cuando cambia el vocabulario o el prompt: lo de versión vieja se vuelve a clasificar. */
export const TRAITS_VERSION = 1

export const RASGOS = {
  plano: ["primer_plano", "cenital", "medio", "ambiente"],
  protagonista: ["producto", "manos_proceso", "persona", "local", "placa"],
  accion: ["vapor", "corte", "armado", "salsa", "servido", "nada"],
  luz_temp: ["calida", "fria"],
  luz_nivel: ["clara", "oscura"],
  fondo: ["limpio", "cargado"],
} as const
export type RasgoCampo = keyof typeof RASGOS
export const RASGO_CAMPOS = Object.keys(RASGOS) as RasgoCampo[]

export type Rasgos = { [K in RasgoCampo]: (typeof RASGOS)[K][number] | null } & {
  /** Solo video: cortes por segundo (medido con ffmpeg, no por la IA). */
  ritmo: number | null
  /** Solo video: duración en segundos. */
  duracion_s: number | null
}

/**
 * Normaliza lo que devuelve la IA: un valor fuera del vocabulario se descarta (queda null), no se
 * adivina. El ritmo y la duración solo si son números razonables.
 */
export function normalizarRasgos(raw: unknown): Rasgos {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const out = {} as Record<string, unknown>
  for (const campo of RASGO_CAMPOS) out[campo] = esDe(RASGOS[campo], r[campo]) ? r[campo] : null
  const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 100) / 100 : null)
  out.ritmo = num(r.ritmo, 30)
  out.duracion_s = num(r.duracion_s, 36_000)
  return out as Rasgos
}

/** Ritmo de edición: cortes por segundo. Sin duración no hay ritmo. */
export function ritmoDeCortes(cortes: number[], duracionS: number | null): number | null {
  if (!duracionS || duracionS <= 0) return null
  return Math.round((cortes.length / duracionS) * 100) / 100
}

// ── Backfill de rasgos: cuánto se hace por tanda sin pasarse del tope de costo ──

/**
 * Cuántos elementos procesar en esta tanda. Deja margen: una tanda nunca puede llevar el gasto
 * por encima del tope aunque cada uno cueste lo estimado.
 */
export function tandaDentroDelTope(opts: { pendientes: number; gastadoUsd: number; topeUsd: number; porItemUsd: number; tanda: number }): number {
  const { pendientes, gastadoUsd, topeUsd, porItemUsd, tanda } = opts
  if (pendientes <= 0 || !(topeUsd > 0) || gastadoUsd >= topeUsd) return 0
  if (!(porItemUsd > 0)) return Math.min(pendientes, tanda)
  const alcanza = Math.floor((topeUsd - gastadoUsd) / porItemUsd)
  return Math.max(0, Math.min(pendientes, tanda, alcanza))
}

/** Precios de lista (USD por millón de tokens) para estimar y aplicar el tope. Sin precio: el más caro conocido. */
const PRECIOS: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-haiku-4-5": { in: 1, out: 5, cacheRead: 0.1 },
  "claude-sonnet-5": { in: 3, out: 15, cacheRead: 0.3 },
}
export function costoUsd(model: string, u: { input: number; output: number; cacheRead?: number }): number {
  const p = PRECIOS[model] ?? PRECIOS[Object.keys(PRECIOS).find((k) => model.startsWith(k)) ?? ""] ?? { in: 15, out: 75, cacheRead: 1.5 }
  return (u.input * p.in + u.output * p.out + (u.cacheRead ?? 0) * p.cacheRead) / 1_000_000
}

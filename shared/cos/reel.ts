/**
 * Guion de un reel (F9 · video primero). Lo propone la IA y lo arma el motor del worker.
 * Sin dependencias: lo usan el worker y los tests.
 */

export type Movimiento = "acercar" | "alejar" | "paneo_derecha" | "paneo_izquierda"
export type Transicion = "corte" | "fundido"
export type Fuente = { tipo: "foto" | "video"; duracion: number | null } // duracion en s (videos)
export type Toma = {
  fuente: number // índice en la lista de fuentes
  trim_start: number // s dentro del video (0 en fotos)
  duracion: number
  movimiento: Movimiento
  foco_x: number // 0..1: hacia dónde se acerca (lo más apetitoso)
  foco_y: number
  transicion: Transicion // cómo entra (la primera siempre "corte")
}
export type GuionReel = {
  tomas: Toma[]
  gancho: string // texto sobre la primera toma (y la tapa)
  medio: string // texto sobre la tercera toma ("" = ninguno)
  titulo_cierre: string
  recuadro: string // "" = sin recuadro
  musica: string | null // clave en cos-media/music/<marca>/
}

export const RECUADROS = ["SUSHI PREMIUM", "PRECIO INTELIGENTE", "PEDILO ONLINE", "PLAN EN CASA", "ENTRÁ Y PEDÍ", "PEDÍ ONLINE", "DELIVERY"] as const
export const TOMA_MIN = 1.5
export const TOMA_MAX = 3.2
export const CIERRE = 2.8 // s de la placa final
export const FUNDIDO = 0.45
export const CORTE = 0.04 // un corte "seco" es un fundido de un cuadro

const MOVS: Movimiento[] = ["acercar", "alejar", "paneo_derecha", "paneo_izquierda"]
const num = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) ? v : def)
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const texto = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/#\S+/g, "").replace(/\p{Extended_Pictographic}/gu, "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, max) : ""

/**
 * Deja el guion de la IA dentro de lo posible: tomas de largo razonable, dentro del video,
 * fuentes que existen, textos cortos, recuadro de la lista. Tira las tomas imposibles.
 */
export function normalizarGuion(raw: unknown, fuentes: Fuente[], musicas: string[] = []): GuionReel {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const tomas: Toma[] = []
  for (const t of Array.isArray(r.tomas) ? (r.tomas as Record<string, unknown>[]) : []) {
    const i = num(t.fuente, -1)
    const f = fuentes[i]
    if (!f || !Number.isInteger(i)) continue
    let duracion = clamp(num(t.duracion, 2.4), TOMA_MIN, TOMA_MAX)
    let trim = 0
    if (f.tipo === "video") {
      const total = f.duracion ?? 0
      if (total < 0.8) continue
      duracion = Math.min(duracion, total)
      trim = clamp(num(t.trim_start, 0), 0, Math.max(0, total - duracion))
    }
    tomas.push({
      fuente: i,
      trim_start: Math.round(trim * 100) / 100,
      duracion: Math.round(duracion * 100) / 100,
      movimiento: MOVS.includes(t.movimiento as Movimiento) ? (t.movimiento as Movimiento) : "acercar",
      foco_x: clamp(num(t.foco_x, 0.5), 0.15, 0.85),
      foco_y: clamp(num(t.foco_y, 0.5), 0.15, 0.85),
      transicion: tomas.length === 0 ? "corte" : t.transicion === "fundido" ? "fundido" : "corte",
    })
    if (tomas.length >= 8) break
  }
  const recuadro = texto(r.recuadro, 24)
  const musica = typeof r.musica === "string" && musicas.includes(r.musica) ? r.musica : (musicas[0] ?? null)
  return {
    tomas,
    gancho: texto(r.gancho, 28),
    medio: tomas.length >= 3 ? texto(r.medio, 28) : "",
    titulo_cierre: texto(r.titulo_cierre, 24),
    recuadro: (RECUADROS as readonly string[]).includes(recuadro) ? recuadro : "",
    musica,
  }
}

/** Cuándo empieza cada toma y el cierre (las transiciones se superponen) y cuánto dura todo. */
export function lineaDeTiempo(tomas: Pick<Toma, "duracion" | "transicion">[]): { inicios: number[]; cierre: number; total: number } {
  const inicios: number[] = []
  let fin = 0
  tomas.forEach((t, i) => {
    const solapa = i === 0 ? 0 : t.transicion === "fundido" ? FUNDIDO : CORTE
    const ini = i === 0 ? 0 : fin - solapa
    inicios.push(ini)
    fin = ini + t.duracion
  })
  const cierre = Math.max(0, fin - FUNDIDO)
  return { inicios, cierre, total: cierre + CIERRE }
}

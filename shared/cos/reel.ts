/**
 * Guion de un reel (F9 · video primero). Lo propone la IA y lo arma el motor del worker.
 * Sin dependencias: lo usan el worker y los tests.
 */
import { LIMITES_RITMO, type Ritmo } from "./ritmo.ts"

export type Movimiento = "acercar" | "alejar" | "paneo_derecha" | "paneo_izquierda"
export type Transicion = "corte" | "fundido"
/** duracion en s (videos). excluir = partes del video que Javier marcó para no usar, [desde, hasta] en s. */
export type Fuente = { tipo: "foto" | "video"; duracion: number | null; excluir?: [number, number][] }
export type Toma = {
  fuente: number // índice en la lista de fuentes
  trim_start: number // s dentro del video (0 en fotos)
  duracion: number
  movimiento: Movimiento
  foco_x: number // 0..1: hacia dónde se acerca (lo más apetitoso)
  foco_y: number
  transicion: Transicion // cómo entra (la primera siempre "corte")
  por_que?: string // para Javier, en Aprobaciones
}
export type GuionReel = {
  tomas: Toma[]
  gancho: string // texto sobre la primera toma (y la tapa)
  medio: string // texto sobre la tercera toma ("" = ninguno)
  titulo_cierre: string
  recuadro: string // "" = sin recuadro
  musica: string | null // nombre del archivo en cos-media/music/<marca>/
  combo: string // nombre EXACTO de un combo de Datos vigentes ("" = ninguno)
  idea: string // una línea: qué cuenta el reel
  /** Precio y pie del cierre, congelados al armar el borrador (salen de Datos vigentes, nunca de la IA). */
  cierre?: { precio: string | null; pie: string | null }
  /** «ráfaga»: muchas tomas cortas, cortes secos al pulso (sale de las referencias de Reels de la marca). */
  ritmo?: Ritmo
  /** Palabra por corte (estilo karaoke): una palabra de una frase de la marca sobre cada toma. */
  palabras?: string[]
  /** Tomas en marcos levemente inclinados sobre el color de la marca (va con la palabra por corte). */
  inclinado?: boolean
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
 * Palabras que la IA propuso en las pruebas y van contra el brandbook: escasez inventada, frescura
 * como promesa, bebida protagonista. Se comparan sin tildes. Se suman las prohibidas de la marca.
 */
export const PALABRAS_FUERA = ["brindis", "vino", "cerveza", "recien hecho", "fresquisimo", "ultimos", "ultimas", "agotar", "agotado", "cupos", "stock"]
const sinTildes = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
export function tieneProhibida(textoLibre: string, extra: string[] = []): boolean {
  const t = ` ${sinTildes(textoLibre).replace(/[^a-z0-9ñ ]+/g, " ")} `
  return [...PALABRAS_FUERA, ...extra.map(sinTildes)].some((p) => p.trim() && t.includes(` ${p.trim()} `))
}

/**
 * Partes excluidas de un video, limpias: dentro del video, de al menos 0,1 s, ordenadas y unidas
 * si se pisan. Lo que no se entiende se descarta.
 */
export function normalizarExcluidos(raw: unknown, total?: number | null): [number, number][] {
  const tramos: [number, number][] = []
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!Array.isArray(x) || x.length !== 2) continue
    let [a, b] = [Number(x[0]), Number(x[1])]
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    if (a > b) [a, b] = [b, a]
    a = Math.max(0, a)
    if (total != null) b = Math.min(total, b)
    if (b - a >= 0.1) tramos.push([Math.round(a * 100) / 100, Math.round(b * 100) / 100])
  }
  tramos.sort((x, y) => x[0] - y[0])
  const unidos: [number, number][] = []
  for (const t of tramos) {
    const ult = unidos[unidos.length - 1]
    if (ult && t[0] <= ult[1]) ult[1] = Math.max(ult[1], t[1])
    else unidos.push([...t])
  }
  return unidos.slice(0, 20)
}

/**
 * Corre una toma para que no toque ninguna parte excluida: el inicio libre más cercano al que
 * pidió la IA. null = no entra en ningún lado (se descarta la toma).
 */
export function ventanaLibre(trim: number, duracion: number, total: number, excluir: [number, number][] = []): number | null {
  const choca = (t: number) => excluir.some(([a, b]) => t < b && t + duracion > a)
  if (!choca(trim)) return trim
  const max = total - duracion
  const candidatos = [0, max, ...excluir.flatMap(([a, b]) => [b, a - duracion])].filter((t) => t >= 0 && t <= max + 1e-9 && !choca(t))
  if (!candidatos.length) return null
  return candidatos.reduce((mejor, t) => (Math.abs(t - trim) < Math.abs(mejor - trim) ? t : mejor))
}

/**
 * Deja el guion de la IA dentro de lo posible: tomas de largo razonable, dentro del video,
 * fuentes que existen, textos cortos, recuadro de la lista, combo que exista, sin palabras fuera
 * del brandbook. Tira las tomas imposibles.
 */
export function normalizarGuion(
  raw: unknown,
  fuentes: Fuente[],
  musicas: string[] = [],
  opts: { combos?: string[]; prohibidas?: string[]; ritmo?: Ritmo; karaoke?: boolean } = {},
): GuionReel {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const tomas: Toma[] = []
  const ritmo: Ritmo = opts.ritmo ?? "normal"
  const lim = ritmo === "rafaga" ? LIMITES_RITMO.rafaga : { min: TOMA_MIN, max: TOMA_MAX, maxTomas: 8 }
  for (const t of Array.isArray(r.tomas) ? (r.tomas as Record<string, unknown>[]) : []) {
    const i = num(t.fuente, -1)
    const f = fuentes[i]
    if (!f || !Number.isInteger(i)) continue
    let duracion = clamp(num(t.duracion, ritmo === "rafaga" ? 0.7 : 2.4), lim.min, lim.max)
    let trim = 0
    if (f.tipo === "video") {
      const total = f.duracion ?? 0
      if (total < (ritmo === "rafaga" ? lim.min : 0.8)) continue
      duracion = Math.min(duracion, total)
      trim = clamp(num(t.trim_start, 0), 0, Math.max(0, total - duracion))
      // Partes que Javier marcó para no usar: la toma se corre al hueco libre más cercano.
      const libre = ventanaLibre(trim, duracion, total, f.excluir)
      if (libre == null) continue
      trim = libre
    }
    tomas.push({
      fuente: i,
      trim_start: Math.round(trim * 100) / 100,
      duracion: Math.round(duracion * 100) / 100,
      movimiento: MOVS.includes(t.movimiento as Movimiento) ? (t.movimiento as Movimiento) : "acercar",
      foco_x: clamp(num(t.foco_x, 0.5), 0.15, 0.85),
      foco_y: clamp(num(t.foco_y, 0.5), 0.15, 0.85),
      // En ráfaga, todos cortes secos (así se arma uniendo los clips, sin superponerlos).
      transicion: tomas.length === 0 || ritmo === "rafaga" ? "corte" : t.transicion === "fundido" ? "fundido" : "corte",
      por_que: typeof t.por_que === "string" ? t.por_que.replace(/\s+/g, " ").trim().slice(0, 160) : "",
    })
    if (tomas.length >= lim.maxTomas) break
  }
  const recuadro = texto(r.recuadro, 24)
  const musica = typeof r.musica === "string" && musicas.includes(r.musica) ? r.musica : (musicas[0] ?? null)
  // Un texto con una palabra fuera del brandbook no se corrige: se descarta.
  const limpio = (v: unknown, max: number) => {
    const t = texto(v, max)
    return t && !tieneProhibida(t, opts.prohibidas) ? t : ""
  }
  const medio = tomas.length >= 3 ? limpio(r.medio, 28) : ""
  const titulo = limpio(r.titulo_cierre, 24)
  // La tapa no puede quedar vacía: si el gancho no pasa, se usa otro texto que sí pasó.
  const gancho = limpio(r.gancho, 28) || titulo || medio
  const combo = typeof r.combo === "string" ? (opts.combos ?? []).find((c) => sinTildes(c) === sinTildes(r.combo as string).trim()) ?? "" : ""
  return {
    tomas,
    gancho,
    medio,
    titulo_cierre: titulo,
    recuadro: (RECUADROS as readonly string[]).includes(recuadro) ? recuadro : "",
    musica,
    combo,
    idea: typeof r.idea === "string" ? r.idea.replace(/\s+/g, " ").trim().slice(0, 240) : "",
    ...(ritmo === "rafaga" ? { ritmo } : {}),
    ...(opts.karaoke ? karaoke(r.palabras, tomas.length, opts.prohibidas) : {}),
  }
}

/**
 * Palabra por corte: una palabra (o dos cortas) por toma, en orden, del largo exacto de las tomas.
 * Si la frase de la IA no pasa (palabra prohibida, precio) o no hay, no se ponen palabras.
 */
function karaoke(raw: unknown, n: number, prohibidas?: string[]): { palabras?: string[]; inclinado: true } {
  const lista = (Array.isArray(raw) ? raw : []).map((p) => texto(p, 16)).filter(Boolean)
  const frase = lista.join(" ")
  if (!lista.length || /\$|\d{3,}/.test(frase) || tieneProhibida(frase, prohibidas)) return { inclinado: true }
  return { palabras: Array.from({ length: n }, (_, i) => lista[i] ?? ""), inclinado: true }
}

/**
 * Guion de respaldo, sin IA (si la IA falla o no deja ninguna toma usable): 5 tomas repartidas en
 * las fuentes, alternando movimientos. Videos: tomas dentro de sus cortes medidos (o al medio).
 */
export function guionPorDefecto(fuentes: (Fuente & { cortes?: number[] })[], musicas: string[] = []): GuionReel {
  const movs: Movimiento[] = ["acercar", "paneo_derecha", "alejar", "paneo_izquierda", "acercar"]
  const usables = fuentes.map((f, i) => ({ f, i })).filter(({ f }) => f.tipo === "foto" || (f.duracion ?? 0) >= 0.8)
  const tomas: Toma[] = []
  for (let n = 0; n < 5 && usables.length; n++) {
    const { f, i } = usables[n % usables.length]
    const vuelta = Math.floor(n / usables.length)
    const duracion = f.tipo === "video" ? Math.min(2.4, f.duracion ?? 2.4) : 2.4
    let trim = 0
    if (f.tipo === "video") {
      const total = f.duracion ?? 0
      const inicios = [0, ...(f.cortes ?? [])].filter((c) => c + duracion <= total)
      trim = inicios.length ? inicios[(vuelta * 2) % inicios.length] : Math.max(0, (total - duracion) / 2)
      const libre = ventanaLibre(trim, duracion, total, f.excluir)
      if (libre == null) continue
      trim = libre
    }
    tomas.push({ fuente: i, trim_start: Math.round(trim * 100) / 100, duracion, movimiento: movs[n], foco_x: 0.5, foco_y: 0.5, transicion: n === 0 ? "corte" : n % 2 ? "corte" : "fundido", por_que: "Armado automático (la IA no respondió)" })
  }
  return { tomas, gancho: "", medio: "", titulo_cierre: "", recuadro: "", musica: musicas[0] ?? null, combo: "", idea: "" }
}

/**
 * Precio y pie de la placa final, solo con datos reales (docs/reels/prompts.md §3):
 * precio = el del combo del guion si está activo y tiene precio; pie = "ENVÍOS <zonas>" si es corto,
 * si no el retiro. Nunca inventado.
 */
export function cierreDesdeDatos(combo: string, d: { combos: { nombre: string; precio: string; activo: boolean }[]; zonas: string; retiro: string }): { precio: string | null; pie: string | null } {
  const c = combo ? d.combos.find((x) => x.activo && x.precio && sinTildes(x.nombre) === sinTildes(combo)) : undefined
  const zonas = d.zonas.trim()
  const retiro = d.retiro.trim()
  const pie = zonas && zonas.length <= 40 ? `ENVÍOS ${zonas}` : retiro && retiro.length <= 48 ? retiro : null
  return { precio: c?.precio.trim() || null, pie: pie ? pie.toUpperCase() : null }
}

/** Momento (ms) en que el gancho ya se ve entero: la tapa del reel en el perfil (thumb_offset). */
export const TAPA_MS = 1200

/**
 * Todo lo que cambia el video final. Si cambia algo de esto, se rearma (lección del 29-09: la
 * clave de la pieza tiene que incluir el diseño de la marca).
 */
export function firmaReel(p: { version: string; guion: GuionReel; gancho: string; musicaKey: string | null; fuentes: string[]; kitVersion: string; kitMarca: unknown }): string {
  const { cierre, tomas, ...resto } = p.guion
  return [
    p.version,
    JSON.stringify({ ...resto, tomas: tomas.map((t) => ({ ...t, por_que: undefined })), cierre: cierre ?? null }),
    p.gancho,
    p.musicaKey ?? "",
    p.fuentes.join(","),
    p.kitVersion,
    JSON.stringify(p.kitMarca ?? null),
  ].join("\x1f")
}

/** Cuándo empieza cada toma y el cierre (las transiciones se superponen) y cuánto dura todo. */
export function lineaDeTiempo(tomas: Pick<Toma, "duracion" | "transicion">[], ritmo: Ritmo = "normal"): { inicios: number[]; cierre: number; total: number } {
  const inicios: number[] = []
  let fin = 0
  tomas.forEach((t, i) => {
    // Ráfaga: los clips se unen uno detrás del otro (sin superponer); normal: fundido de un cuadro o más.
    const solapa = i === 0 || ritmo === "rafaga" ? 0 : t.transicion === "fundido" ? FUNDIDO : CORTE
    const ini = i === 0 ? 0 : fin - solapa
    inicios.push(ini)
    fin = ini + t.duracion
  })
  const cierre = Math.max(0, fin - FUNDIDO)
  return { inicios, cierre, total: cierre + CIERRE }
}

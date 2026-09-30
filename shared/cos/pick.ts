/**
 * F7 · Motor de gustos (M2): elige la música (y, donde el backtest lo habilita, la imagen) de cada
 * pieza. Puro, sin dependencias, con tests.
 *
 *   1. Filtro duro: solo candidatos permitidos (misma marca, activos, no el actual si se pide otro).
 *   2. ~70 % aprovecha lo que mejor viene rindiendo (esperado × desgaste); hasta 30 % prueba con
 *      muestreo de Thompson (sorteo dentro de la incertidumbre de cada candidato). 0 % en campañas,
 *      feriados y fechas especiales.
 *   3. Semilla derivada del post: un reintento elige lo mismo (idempotente).
 *   4. Devuelve el porqué (pick_json) para mostrarlo en Aprobaciones y aprender de los cambios.
 */

export type Candidato = {
  id: string
  titulo: string
  /** Efecto esperado (multiplicador): 1 = como siempre. */
  efecto: number
  /** Incertidumbre en log (desvío). Más grande = sabemos menos = más chances al probar. */
  incertidumbre: number
  /** Usos en las últimas piezas de la marca (desgaste). */
  usosRecientes: number
  /** Cuántas publicaciones propias tiene (0 = solo lo que heredó de sus rasgos). */
  n: number
}

export type Eleccion = {
  elegido: string
  titulo: string
  modo: "aprovechar" | "probar"
  esperado: number
  candidatos: { id: string; titulo: string; esperado: number; muestra: number }[]
  semilla: string
  exploracion: number
  modelo?: string
}

export const TOPE_EXPLORACION = 0.3

/** Generador determinístico (mulberry32) a partir de un texto. */
export function rng(semilla: string): () => number {
  let h = 1779033703 ^ semilla.length
  for (let i = 0; i < semilla.length; i++) {
    h = Math.imul(h ^ semilla.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Normal estándar (Box–Muller). */
function normal(r: () => number): number {
  const u = Math.max(1e-12, r())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}

/** Incertidumbre (log) a partir de cuánta historia tiene un candidato: sin historia, amplia. */
export function incertidumbrePorN(n: number): number {
  return 0.35 / Math.sqrt(1 + n / 4)
}

/** Lo repetido hace poco pierde: −5 % por uso, piso 70 % (igual que taste.desgaste). */
const gasto = (u: number) => Math.max(0.7, 1 - 0.05 * Math.max(0, u))

/**
 * Elige un candidato. `exploracion` = tope de la probabilidad de probar (0 en campañas).
 * Devuelve null si no hay candidatos.
 */
export function elegir(candidatos: Candidato[], opts: { semilla: string; exploracion?: number; excluir?: string[]; modelo?: string }): Eleccion | null {
  const lista = candidatos.filter((c) => !(opts.excluir ?? []).includes(c.id))
  if (!lista.length) return null
  const r = rng(opts.semilla)
  const tope = Math.min(TOPE_EXPLORACION, Math.max(0, opts.exploracion ?? TOPE_EXPLORACION))
  const esperado = (c: Candidato) => c.efecto * gasto(c.usosRecientes)
  const probar = r() < tope
  const conMuestra = lista.map((c) => ({ c, esp: esperado(c), muestra: Math.exp(Math.log(esperado(c)) + c.incertidumbre * normal(r)) }))
  const mejor = conMuestra.reduce((a, b) => (b.esp > a.esp ? b : a))
  const sorteado = conMuestra.reduce((a, b) => (b.muestra > a.muestra ? b : a))
  const g = probar ? sorteado : mejor
  return {
    elegido: g.c.id,
    titulo: g.c.titulo,
    // Solo cuenta como prueba si el sorteo eligió algo distinto de lo que mejor viene rindiendo.
    modo: probar && g.c.id !== mejor.c.id ? "probar" : "aprovechar",
    esperado: round(g.esp),
    candidatos: conMuestra
      .sort((a, b) => b.esp - a.esp)
      .slice(0, 8)
      .map((x) => ({ id: x.c.id, titulo: x.c.titulo, esperado: round(x.esp), muestra: round(x.muestra) })),
    semilla: opts.semilla,
    exploracion: tope,
    modelo: opts.modelo,
  }
}

/** Orden de los candidatos por lo que se espera (para darle a la IA del reel los 3 mejores). */
export function ordenar(candidatos: Candidato[]): Candidato[] {
  return [...candidatos].sort((a, b) => b.efecto * gasto(b.usosRecientes) - a.efecto * gasto(a.usosRecientes))
}

/** "🎵 Piano jazz · elegida por el motor (+18 %, confianza media)" / "🧪 Probando: …" */
export function porqueMusica(e: Pick<Eleccion, "modo" | "titulo" | "esperado">, n: number): string {
  if (e.modo === "probar") return `🧪 Probando: ${e.titulo}`
  const p = Math.round((e.esperado - 1) * 100)
  const conf = n >= 15 ? "confianza alta" : n >= 5 ? "confianza media" : "poca data: por sus rasgos"
  return `🎵 ${e.titulo} · elegida por el motor (${Math.abs(p) < 3 ? "como siempre" : `${p > 0 ? "+" : "−"}${Math.abs(p)} %`}, ${conf})`
}

const round = (x: number) => Math.round(x * 1000) / 1000

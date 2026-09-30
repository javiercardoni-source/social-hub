/**
 * F7 · Motor de gustos (M1): qué rasgos (música, tipo de imagen) le gustan al público de cada marca.
 * Puro, sin dependencias, con tests. Se monta sobre el motor de horarios: mide el contenido
 * DESCONTANDO lo que explica la franja día×hora (no lo reinventa).
 *
 *   liftsPorMetrica   rendimiento de cada post en cada métrica, vs su época y formato, ÷ su franja
 *   puntaje           objetivo gusta / crece / conversa = media geométrica ponderada de los lifts
 *   efectosRasgos     efecto de cada rasgo (plano, protagonista, género…) con contracción + intervalo
 *   ridge             todos los rasgos a la vez (con ≥150 posts), para no confundir rasgos que van juntos
 *   efectoTema        un tema sin historia hereda el efecto de sus rasgos
 *   desgaste          lo repetido hace poco pierde
 *   backtest          ¿predice mejor que "la mediana de siempre"? (si no, no elige imágenes)
 */

export type Metricas = Record<string, number>
export type Formato = "feed" | "reel" | "story" | "carousel" | "video"
export type PostGusto = {
  id: string
  account: string
  format: Formato
  postedAt: string
  metrics: Metricas
  /** Rasgos: { plano: "cenital", protagonista: "producto", genero: "jazz", … } (valores de vocabulario cerrado). */
  rasgos: Record<string, string | null>
  /** Factor de su franja día×hora (del motor de horarios): 1 = franja promedio. */
  franja?: number
}

// ── Métricas y objetivos ───────────────────────────────────────────────────

/** Cada componente se calcula de las métricas crudas de Meta (lo que no está, no cuenta). */
export const COMPONENTES: Record<string, (m: Metricas) => number | null> = {
  vistas: (m) => pos(m.views) ?? pos(m.reach),
  interaccion: (m) => {
    const base = pos(m.reach) ?? pos(m.views)
    if (!base) return null
    const i = (m.likes ?? 0) + 2 * (m.comments ?? 0) + 3 * (m.saved ?? 0) + 3 * (m.shares ?? 0)
    return i > 0 ? i / base : null
  },
  retencion: (m) => pos(m.ig_reels_avg_watch_time),
  seguidores: (m) => pos(m.follows),
  perfil: (m) => pos(m.profile_visits),
  conversacion: (m) => {
    const c = 2 * (m.comments ?? 0) + (m.replies ?? 0) + (m.shares ?? 0)
    return c > 0 ? c : null
  },
  clics: (m) => pos(m.clicks),
}
const pos = (x: number | undefined) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null)

export type Objetivo = "gusta" | "crece" | "conversa"
/** Pesos por objetivo (editables por marca más adelante). Decisión de Javier: entran TODAS las métricas. */
export const OBJETIVOS: Record<Objetivo, Record<string, number>> = {
  gusta: { vistas: 0.45, interaccion: 0.45, retencion: 0.1 },
  crece: { seguidores: 0.6, perfil: 0.4 },
  conversa: { conversacion: 0.7, interaccion: 0.3 },
}

const EPOCA_MS = 60 * 86_400_000
const MIN_EPOCA = 5
const MAX_LIFT = 4
const MIN_LIFT = 0.1

function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  if (!s.length) return 0
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Lift de cada componente para cada post: su valor ÷ la mediana del mismo componente en su cuenta y
 * formato, en ±60 días (su época), dividido por el factor de su franja. Acotado entre 0,1 y 4.
 */
export function liftsPorMetrica(posts: PostGusto[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>()
  const grupos = new Map<string, PostGusto[]>()
  for (const p of posts) grupos.set(`${p.account}|${p.format}`, [...(grupos.get(`${p.account}|${p.format}`) ?? []), p])
  for (const g of grupos.values()) {
    const ts = g.map((p) => Date.parse(p.postedAt))
    for (const [c, f] of Object.entries(COMPONENTES)) {
      const vals = g.map((p) => f(p.metrics))
      const global = mediana(vals.filter((v): v is number => v != null))
      g.forEach((p, i) => {
        const v = vals[i]
        if (v == null) return
        const epoca = vals.filter((x, j) => x != null && Math.abs(ts[j] - ts[i]) <= EPOCA_MS) as number[]
        const base = epoca.length >= MIN_EPOCA ? mediana(epoca) : global
        if (!(base > 0)) return
        // La franja explica parte del alcance, no de la calidad del contenido: se descuenta de las vistas.
        const franja = c === "vistas" || c === "seguidores" || c === "perfil" ? p.franja ?? 1 : 1
        const l = Math.min(MAX_LIFT, Math.max(MIN_LIFT, v / base / (franja > 0 ? franja : 1)))
        out.set(p.id, { ...(out.get(p.id) ?? {}), [c]: l })
      })
    }
  }
  return out
}

/** Puntaje de un objetivo: media geométrica ponderada de los componentes que el post tiene. */
export function puntaje(lifts: Record<string, number> | undefined, objetivo: Objetivo): number | null {
  if (!lifts) return null
  let s = 0
  let w = 0
  for (const [c, peso] of Object.entries(OBJETIVOS[objetivo])) {
    const l = lifts[c]
    if (l == null) continue
    s += peso * Math.log(l)
    w += peso
  }
  return w > 0 ? Math.exp(s / w) : null
}

// ── Efecto de los rasgos ───────────────────────────────────────────────────

export type EfectoRasgo = {
  campo: string
  valor: string
  /** Multiplicador (1 = como siempre), contraído hacia 1 con poca evidencia. */
  efecto: number
  n: number
  lo: number
  hi: number
  confianza: "alta" | "media" | "baja"
  claro: boolean
  /** Solo en efectos simples: el rasgo va casi siempre junto con otro (puede estar confundido). */
  junto_con?: string
}
const K = 8

/** Efecto simple de cada valor de cada rasgo: promedio del log-puntaje de los posts que lo tienen, contraído. */
export function efectosRasgos(items: { rasgos: PostGusto["rasgos"]; score: number }[]): EfectoRasgo[] {
  const L = items.filter((x) => x.score > 0).map((x) => ({ r: x.rasgos, y: Math.log(x.score) }))
  const media = L.length ? L.reduce((a, b) => a + b.y, 0) / L.length : 0
  const pares = new Map<string, number[]>()
  for (const { r, y } of L) for (const [c, v] of Object.entries(r)) if (v) pares.set(`${c}=${v}`, [...(pares.get(`${c}=${v}`) ?? []), y - media])
  const out: EfectoRasgo[] = []
  for (const [k, ys] of pares) {
    const [campo, valor] = k.split("=")
    const n = ys.length
    const suma = ys.reduce((a, b) => a + b, 0)
    const m = suma / (n + K)
    const varz = n > 1 ? ys.reduce((a, b) => a + (b - suma / n) ** 2, 0) / (n - 1) : 0.5
    const se = Math.sqrt(varz / (n + K))
    const efecto = Math.exp(m)
    const lo = Math.exp(m - 1.28 * se)
    const hi = Math.exp(m + 1.28 * se)
    out.push({ campo, valor, efecto: r3(efecto), n, lo: r3(lo), hi: r3(hi), confianza: n >= 40 ? "alta" : n >= 15 ? "media" : "baja", claro: n >= 8 && Math.abs(efecto - 1) >= 0.05 && (lo > 1 || hi < 1) })
  }
  // Advertencia de confusión: si casi todos los posts con este rasgo tienen además otro rasgo concreto.
  for (const e of out) {
    const con = L.filter((x) => x.r[e.campo] === e.valor)
    if (con.length < 5) continue
    let mejor: { k: string; frac: number } | null = null
    for (const [k] of pares) {
      const [c, v] = k.split("=")
      if (c === e.campo) continue
      const frac = con.filter((x) => x.r[c] === v).length / con.length
      const general = L.filter((x) => x.r[c] === v).length / L.length
      if (frac >= 0.85 && general < 0.7 && (!mejor || frac > mejor.frac)) mejor = { k, frac }
    }
    if (mejor) e.junto_con = mejor.k.replace("=", ": ")
  }
  return out.sort((a, b) => b.n - a.n)
}

/**
 * Regresión con contracción (ridge) sobre todos los rasgos a la vez: separa rasgos que van juntos
 * ("el jazz rinde" vs "los reels con jazz eran justo los de sushi cenital"). Solo con ≥ 150 posts.
 */
export function ridge(items: { rasgos: PostGusto["rasgos"]; score: number }[], lambda = 10): { coef: Record<string, number>; n: number } | null {
  const L = items.filter((x) => x.score > 0)
  if (L.length < 150) return null
  const feats = [...new Set(L.flatMap((x) => Object.entries(x.rasgos).filter(([, v]) => v).map(([c, v]) => `${c}=${v}`)))]
  const p = feats.length
  if (!p) return null
  const idx = new Map(feats.map((f, i) => [f, i]))
  const media = L.reduce((a, b) => a + Math.log(b.score), 0) / L.length
  const A = Array.from({ length: p }, () => new Array(p).fill(0))
  const b = new Array(p).fill(0)
  for (const x of L) {
    const on = Object.entries(x.rasgos).filter(([, v]) => v).map(([c, v]) => idx.get(`${c}=${v}`)!)
    const y = Math.log(x.score) - media
    for (const i of on) {
      b[i] += y
      for (const j of on) A[i][j] += 1
    }
  }
  for (let i = 0; i < p; i++) A[i][i] += lambda
  const beta = resolver(A, b)
  return { coef: Object.fromEntries(feats.map((f, i) => [f, r3(Math.exp(beta[i]))])), n: L.length }
}

/** Gauss con pivoteo parcial (matriz chica: decenas de rasgos). */
function resolver(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    ;[M[c], M[piv]] = [M[piv], M[c]]
    const d = M[c][c] || 1e-9
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / d
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-9))
}

// ── Música ─────────────────────────────────────────────────────────────────

/** Rasgos de un tema para el motor (tramos, así un tema nuevo hereda de los parecidos). */
export function rasgosDeTema(t: { genre: string | null; mood: string[]; vocals: boolean | null; bpm: number | null; energy: number | null }): Record<string, string | null> {
  return {
    genero: t.genre,
    mood: t.mood[0] ?? null,
    voz: t.vocals == null ? null : t.vocals ? "con_voz" : "instrumental",
    bpm: t.bpm == null ? null : t.bpm < 110 ? "lento" : t.bpm <= 125 ? "medio" : "rapido",
    energia: t.energy == null ? null : t.energy < 0.6 ? "baja" : t.energy <= 0.8 ? "media" : "alta",
  }
}

/**
 * Efecto de un tema: lo que se vio de ESE tema, contraído hacia lo que se espera por sus rasgos.
 * Un tema nuevo (n = 0) es exactamente lo heredado.
 */
export function efectoTema(propio: { suma: number; n: number }, rasgos: Record<string, string | null>, efectos: EfectoRasgo[]): { efecto: number; heredado: number; n: number } {
  let h = 0
  for (const [c, v] of Object.entries(rasgos)) {
    const e = efectos.find((x) => x.campo === c && x.valor === v)
    if (e) h += Math.log(e.efecto)
  }
  const m = (propio.suma + K * h) / (propio.n + K)
  return { efecto: r3(Math.exp(m)), heredado: r3(Math.exp(h)), n: propio.n }
}

/** Lo repetido hace poco pierde: −5 % por cada uso en las últimas N piezas (piso 70 %). */
export function desgaste(usosRecientes: number): number {
  return Math.max(0.7, 1 - 0.05 * Math.max(0, usosRecientes))
}

// ── Backtest ───────────────────────────────────────────────────────────────

/**
 * Entrena con todo lo anterior a cada mes y predice ese mes. Compara el error (en log) contra
 * "la mediana de siempre" (predecir 1). Sin fuga en los efectos: los de un mes solo usan meses previos.
 * (El puntaje de cada post se normaliza con su época de ±60 días, que puede incluir posts posteriores:
 * es la escala de medida, no lo que se aprende; se acepta.)
 */
export function backtest(items: { rasgos: PostGusto["rasgos"]; score: number; postedAt: string }[], meses = 6): { meses: number; n: number; errorModelo: number; errorBase: number; gana: boolean } {
  const L = items.filter((x) => x.score > 0).sort((a, b) => a.postedAt.localeCompare(b.postedAt))
  const mesesUnicos = [...new Set(L.map((x) => x.postedAt.slice(0, 7)))].slice(-meses)
  let eM = 0
  let eB = 0
  let n = 0
  for (const mes of mesesUnicos) {
    const train = L.filter((x) => x.postedAt.slice(0, 7) < mes)
    const test = L.filter((x) => x.postedAt.slice(0, 7) === mes)
    if (train.length < 20 || !test.length) continue
    const ef = efectosRasgos(train)
    // Los dos parten del mismo punto, "la mediana de siempre" del entrenamiento: así lo único que se
    // compara es si los efectos de los rasgos agregan algo (el promedio se corre por los virales).
    const base = mediana(train.map((x) => Math.log(x.score)))
    for (const t of test) {
      let pred = base
      for (const [c, v] of Object.entries(t.rasgos)) {
        // Igual que el motor: solo actúa sobre efectos claros (lo demás es ruido).
        const e = ef.find((x) => x.campo === c && x.valor === v && x.claro)
        if (e) pred += Math.log(e.efecto)
      }
      const real = Math.log(t.score)
      eM += Math.abs(real - pred)
      eB += Math.abs(real - base)
      n++
    }
  }
  const errorModelo = n ? r3(eM / n) : 0
  const errorBase = n ? r3(eB / n) : 0
  // Tiene que ganar por algo (2 %) y con una muestra mínima: si no, no elige.
  return { meses: mesesUnicos.length, n, errorModelo, errorBase, gana: n >= 30 && errorModelo < errorBase * 0.98 }
}

const r3 = (x: number) => Math.round(x * 1000) / 1000

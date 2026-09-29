/**
 * Motor de horarios (F1, .gauntlet/features/f1-analytics/spec.md).
 *
 * Aprende de lo que ya pasó: cada publicación rindió X veces el alcance típico de su cuenta y
 * formato. Promedia ese rendimiento por franja (día × hora de Buenos Aires) con contracción
 * bayesiana: una franja con 1 o 2 posts no manda; se apoya en el efecto de su hora y de su día.
 *
 * Sin dependencias y sin sintaxis exclusiva de TypeScript: lo usan la web y el worker.
 */

export type Format = "feed" | "reel" | "story" | "carousel" | "video"
export type PerfPost = { postedAt: string | Date; format: Format; reach: number }

export const AR_TZ = "America/Argentina/Buenos_Aires"
// Buenos Aires no tiene horario de verano desde 2009: UTC−3 fijo.
const AR_OFFSET_H = -3
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]

/**
 * Día de la semana (0 = domingo) y hora (0–23) en Buenos Aires.
 * Un feriado (fecha YYYY-MM-DD en `holidays`) se comporta como domingo.
 */
export function arSlot(d: string | Date, holidays?: Set<string>): { dow: number; hour: number } {
  const t = new Date(new Date(d).getTime() + AR_OFFSET_H * 3600_000)
  const feriado = holidays?.has(t.toISOString().slice(0, 10))
  return { dow: feriado ? 0 : t.getUTCDay(), hour: t.getUTCHours() }
}

export function median(xs: number[]): number {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!s.length) return 0
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Un viral no puede definir una franja entera: el rendimiento se acota.
const MAX_LIFT = 4
const MIN_LIFT = 0.1

// Ventana de "su época": una cuenta que creció no hace ver buenos a los posts nuevos solo por nuevos.
const EPOCA_MS = 60 * 86_400_000
const MIN_EPOCA = 5

/**
 * Rendimiento de cada post = alcance / mediana de los posts del mismo formato publicados en
 * ±60 días (su época). Si la época tiene menos de 5 posts, se usa la mediana de todo el período.
 */
export function lifts<T extends PerfPost>(posts: T[]): { post: T; lift: number }[] {
  const valid = posts.filter((p) => Number.isFinite(p.reach) && p.reach > 0)
  const byFormat = new Map<Format, T[]>()
  for (const p of valid) byFormat.set(p.format, [...(byFormat.get(p.format) ?? []), p])
  const out: { post: T; lift: number }[] = []
  for (const group of byFormat.values()) {
    const global = median(group.map((p) => p.reach))
    const times = group.map((p) => new Date(p.postedAt).getTime())
    group.forEach((p, i) => {
      const epoca = group.filter((_, j) => Math.abs(times[j] - times[i]) <= EPOCA_MS).map((x) => x.reach)
      const base = epoca.length >= MIN_EPOCA ? median(epoca) : global
      if (base > 0) out.push({ post: p, lift: Math.min(MAX_LIFT, Math.max(MIN_LIFT, p.reach / base)) })
    })
  }
  return out
}

const shrink = (sum: number, n: number, prior: number, k: number) => (sum + k * prior) / (n + k)

export type SlotModel = {
  n: number
  /** Rendimiento estimado por franja [dow][hour]: 1 = como siempre, 1,3 = +30 %. */
  grid: number[][]
  /** Cantidad de posts observados por franja [dow][hour]. */
  count: number[][]
  hour: number[]
  day: number[]
  hourN: number[]
}

/** Modelo de franjas. k = cuántos posts "imaginarios" en el promedio empujan hacia lo esperado. */
export function slotModel(posts: PerfPost[], k = 3, holidays?: Set<string>): SlotModel {
  const L = lifts(posts)
  const hs = Array.from({ length: 24 }, () => ({ s: 0, n: 0 }))
  const ds = Array.from({ length: 7 }, () => ({ s: 0, n: 0 }))
  const cell = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ s: 0, n: 0 })))
  for (const { post, lift } of L) {
    const { dow, hour } = arSlot(post.postedAt, holidays)
    hs[hour].s += lift
    hs[hour].n++
    ds[dow].s += lift
    ds[dow].n++
    cell[dow][hour].s += lift
    cell[dow][hour].n++
  }
  // Las horas vecinas se parecen: la hora se suaviza con la anterior y la siguiente.
  const hourRaw = hs.map((h) => shrink(h.s, h.n, 1, k))
  const hour = hourRaw.map((v, i) => {
    const prev = hourRaw[(i + 23) % 24]
    const next = hourRaw[(i + 1) % 24]
    const w = hs[i].n
    return (v * (w + 1) + (prev + next) * 0.5) / (w + 2)
  })
  const day = ds.map((d) => shrink(d.s, d.n, 1, k))
  const grid = cell.map((row, d) => row.map((c, h) => shrink(c.s, c.n, hour[h] * day[d], k)))
  return { n: L.length, grid, count: cell.map((r) => r.map((c) => c.n)), hour, day, hourN: hs.map((h) => h.n) }
}

export type Confianza = "alta" | "media" | "baja"
export type Sugerencia = { at: string; dow: number; hour: number; lift: number; confianza: Confianza; label: string }

/** Confianza de una franja según cuánta evidencia hay en su hora y en el modelo. */
function confianza(m: SlotModel, dow: number, hour: number): Confianza {
  const cercanos = m.count[dow][hour] + m.hourN[hour]
  if (m.n >= 40 && cercanos >= 6) return "alta"
  if (m.n >= 15 && cercanos >= 3) return "media"
  return "baja"
}

/**
 * Mejores franjas de los próximos `days` días. Solo horas permitidas y siempre en el futuro
 * (desde la próxima hora completa + 1). No repite dos franjas a menos de 3 horas en el mismo día.
 */
export function suggestSlots(
  m: SlotModel,
  opts: { from?: Date; days?: number; count?: number; hours?: number[]; allowedDays?: number[]; holidays?: Set<string> } = {},
): Sugerencia[] {
  const from = opts.from ?? new Date()
  const days = opts.days ?? 7
  const hours = opts.hours ?? [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
  const minStart = Math.ceil(from.getTime() / 3600_000) * 3600_000 + 3600_000
  const cands: Sugerencia[] = []
  for (let off = 0; off <= days; off++) {
    // Medianoche de Buenos Aires del día `off`, expresada en UTC.
    const arNow = new Date(from.getTime() + AR_OFFSET_H * 3600_000)
    const midnightUtc = Date.UTC(arNow.getUTCFullYear(), arNow.getUTCMonth(), arNow.getUTCDate() + off) - AR_OFFSET_H * 3600_000
    for (const h of hours) {
      const at = midnightUtc + h * 3600_000
      if (at < minStart || at > from.getTime() + days * 86_400_000) continue
      const { dow } = arSlot(new Date(at), opts.holidays)
      if (opts.allowedDays && !opts.allowedDays.includes(arSlot(new Date(at)).dow)) continue
      // Solo horas con evidencia (en esa hora o en una vecina): el resto sería extrapolar.
      if (m.n > 0 && !m.hourN[h] && !m.hourN[(h + 23) % 24] && !m.hourN[(h + 1) % 24]) continue
      const lift = m.grid[dow][h]
      // La etiqueta muestra el día real (un lunes feriado es "lunes (feriado)", aunque rinda como domingo).
      const real = arSlot(new Date(at)).dow
      const label = `${DIAS[real]}${real !== dow ? " (feriado)" : ""} ${String(h).padStart(2, "0")}:00`
      cands.push({ at: new Date(at).toISOString(), dow, hour: h, lift, confianza: confianza(m, dow, h), label })
    }
  }
  cands.sort((a, b) => b.lift - a.lift)
  const out: Sugerencia[] = []
  for (const c of cands) {
    if (out.some((o) => Math.abs(new Date(o.at).getTime() - new Date(c.at).getTime()) < 3 * 3600_000)) continue
    out.push(c)
    if (out.length >= (opts.count ?? 3)) break
  }
  return out
}

/**
 * Horas donde casi no hay historia (para probar y que el motor aprenda). Si la cuenta publicó
 * siempre a la misma hora, sin explorar nunca se sabría si otra rinde más.
 */
export function explorationHint(m: SlotModel, hours = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]): { concentrada: boolean; habitual: number[]; probar: number[] } {
  const total = m.hourN.reduce((a, b) => a + b, 0)
  if (!total) return { concentrada: false, habitual: [], probar: [] }
  const habitual = m.hourN.map((n, h) => ({ n, h })).filter((x) => x.n / total >= 0.15).map((x) => x.h)
  const cubiertas = habitual.reduce((s, h) => s + m.hourN[h], 0) / total
  const probar = hours.filter((h) => m.hourN[h] + m.hourN[(h + 23) % 24] + m.hourN[(h + 1) % 24] === 0)
  return { concentrada: cubiertas >= 0.8 && habitual.length <= 2, habitual, probar: probar.slice(0, 3) }
}

/** "+38 %" / "−12 %" / "como siempre" */
export function liftText(lift: number): string {
  const p = Math.round((lift - 1) * 100)
  if (Math.abs(p) < 3) return "como siempre"
  return `${p > 0 ? "+" : "−"}${Math.abs(p)} %`
}

/** "martes a sábado" → [2,3,4,5,6]. Sin dato, todos los días. */
export function openDays(text: unknown): number[] | undefined {
  if (typeof text !== "string") return undefined
  const dias = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"]
  const norm = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  const m = norm.match(/(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\s+a\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)/)
  if (!m) return undefined
  const a = dias.indexOf(m[1])
  const b = dias.indexOf(m[2])
  const out: number[] = []
  for (let d = a; ; d = (d + 1) % 7) {
    out.push(d)
    if (d === b) break
  }
  return out
}

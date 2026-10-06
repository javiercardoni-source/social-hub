/**
 * Ritmo de los reels: normal (4 a 6 tomas de 1,6 a 2,8 s) o «ráfaga» (muchas tomas cortas al pulso
 * de la música, como las plantillas de CapCut). Puro, con tests.
 *
 *   ritmoDeReferencias  sale del ritmo MEDIDO en las referencias de Reels de la marca
 *   ajustarAlPulso      la duración de cada toma pasa a un múltiplo del pulso del tema elegido
 *   alPulso             qué parte de los cortes de una referencia cae sobre el pulso de su música
 *   perfilMusical       BPM y energía que piden las referencias (para recomendar qué música buscar)
 */

export type Ritmo = "normal" | "rafaga"
export const LIMITES_RITMO: Record<Ritmo, { min: number; max: number; maxTomas: number }> = {
  normal: { min: 1.5, max: 3.2, maxTomas: 8 },
  rafaga: { min: 0.45, max: 1.2, maxTomas: 24 },
}
/** Por debajo de esta toma promedio (s) en las referencias, la marca va en ráfaga. */
export const UMBRAL_RAFAGA = 1.1

export type MedidaRef = { toma_promedio_s?: number | null } | null | undefined

/** Ráfaga si la MAYORÍA de las referencias de reels con medida van a menos de 1,1 s por toma. */
export function ritmoDeReferencias(medidas: MedidaRef[]): Ritmo {
  const v = medidas.map((m) => m?.toma_promedio_s).filter((x): x is number => typeof x === "number" && x > 0)
  if (!v.length) return "normal"
  const rapidas = v.filter((x) => x < UMBRAL_RAFAGA).length
  return rapidas * 2 > v.length ? "rafaga" : "normal"
}

/**
 * Cada toma dura un número entero de pulsos (o medio pulso si el tema es muy lento para el límite).
 * Así los cortes caen sobre el ritmo. Sin BPM confiable, no se toca nada.
 */
export function ajustarAlPulso<T extends { duracion: number }>(tomas: T[], bpm: number | null | undefined, ritmo: Ritmo): T[] {
  if (!bpm || bpm < 50 || bpm > 220) return tomas
  const { min, max } = LIMITES_RITMO[ritmo]
  let pulso = 60 / bpm
  while (pulso > max) pulso /= 2
  return tomas.map((t) => {
    let n = Math.max(1, Math.round(t.duracion / pulso))
    while (n * pulso > max && n > 1) n--
    while (n * pulso < min) n++
    return { ...t, duracion: Math.round(n * pulso * 1000) / 1000 }
  })
}

/** % de tomas cuyo largo es (casi) un número entero de pulsos o medios pulsos. */
export function alPulso(tomas: number[], bpm: number | null | undefined): number | null {
  if (!bpm || !tomas.length) return null
  const medio = 30 / bpm
  const ok = tomas.filter((d) => {
    const n = d / medio
    return Math.abs(n - Math.round(n)) <= 0.18 && Math.round(n) >= 1
  }).length
  return Math.round((ok / tomas.length) * 100)
}

export type MusicaRef = { bpm?: number | null; confianza?: number | null; energia?: number | null } | null | undefined
export type PerfilMusical = { n: number; bpm: number | null; bpmMin: number | null; bpmMax: number | null; energia: "baja" | "media" | "alta" | null }

export function perfilMusical(ms: MusicaRef[]): PerfilMusical {
  const val = ms.filter((m): m is NonNullable<MusicaRef> => !!m)
  const bpms = val.filter((m) => m.bpm && (m.confianza ?? 1) >= 0.3).map((m) => m.bpm as number).sort((a, b) => a - b)
  const en = val.map((m) => m.energia).filter((e): e is number => typeof e === "number")
  const med = bpms.length ? bpms[Math.floor(bpms.length / 2)] : null
  const e = en.length ? en.reduce((s, x) => s + x, 0) / en.length : null
  return {
    n: val.length,
    bpm: med ? Math.round(med) : null,
    bpmMin: bpms.length ? Math.round(Math.max(bpms[0], (med ?? 0) - 10)) : null,
    bpmMax: bpms.length ? Math.round(Math.min(bpms[bpms.length - 1], (med ?? 0) + 10)) : null,
    energia: e == null ? null : e < 0.4 ? "baja" : e < 0.7 ? "media" : "alta",
  }
}

import { describe, expect, it } from "vitest"
import { candidatosPauta, lunesDe, mencionaAlgoNoVigente, numerosInventados } from "../../shared/cos/sugerencias"

const AHORA = Date.parse("2026-10-05T15:00:00Z")
const hace = (dias: number) => new Date(AHORA - dias * 86_400_000).toISOString()
const vig = { precios: ["$ 31.900"], promos: ["2x1 los martes"] }

function post(i: number, x: { reach?: number; follows?: number; comments?: number; dias?: number; format?: string; caption?: string; pautado?: boolean } = {}) {
  const r = x.reach ?? 100
  return {
    id: `m${i}`,
    account: "ig",
    format: (x.format ?? "reel") as "reel",
    postedAt: hace(x.dias ?? 3 + (i % 10)),
    metrics: { reach: r, views: r, likes: r / 10, comments: x.comments ?? 1, saved: 0, shares: 0, follows: x.follows ?? 1, profile_visits: 2 },
    rasgos: {},
    caption: x.caption ?? "Rico sushi",
    permalink: `https://ig/${i}`,
    pautado: x.pautado ?? false,
  }
}

describe("candidatos a pautar", () => {
  const base = Array.from({ length: 20 }, (_, i) => post(i))
  it("elige lo que rindió claramente más y dice para qué objetivo", () => {
    const c = candidatosPauta([...base, post(99, { follows: 12, reach: 180, dias: 4 })], vig, AHORA)
    expect(c[0].media_id).toBe("m99")
    expect(c[0].objetivo).toBe("crece")
    expect(c[0].destaca).toContain("seguidores ganados")
  })
  it("excluye historias, lo ya pautado, lo muy nuevo (menos de 36 h) y lo de hace más de 14 días", () => {
    const ps = [...base, post(90, { follows: 20, format: "story" }), post(91, { follows: 20, pautado: true }), post(92, { follows: 20, dias: 1 }), post(93, { follows: 20, dias: 20 })]
    expect(candidatosPauta(ps, vig, AHORA).map((c) => c.media_id)).not.toEqual(expect.arrayContaining(["m90", "m91", "m92", "m93"]))
  })
  it("no sugiere pautar una promo o un precio que no están vigentes", () => {
    const ps = [...base, post(95, { follows: 20, caption: "Combo a $ 25.000, aprovechá!" }), post(96, { follows: 20, caption: "30% off solo hoy" })]
    expect(candidatosPauta(ps, vig, AHORA).map((c) => c.media_id)).toEqual([])
  })
  it("nada destacado = nada que pautar", () => {
    expect(candidatosPauta(base, vig, AHORA)).toEqual([])
  })
})

describe("precios y promos vigentes", () => {
  it("precio vigente sí; precio viejo no; promo vigente sí; inventada no", () => {
    expect(mencionaAlgoNoVigente("Qatar a $31.900", vig)).toBe(false)
    expect(mencionaAlgoNoVigente("Qatar a $ 29.900", vig)).toBe(true)
    expect(mencionaAlgoNoVigente("Hoy 2x1 los martes!", vig)).toBe(false)
    expect(mencionaAlgoNoVigente("Promo de cumpleaños", vig)).toBe(true)
    expect(mencionaAlgoNoVigente("Sushi para compartir", vig)).toBe(false)
  })
})

describe("la IA no inventa cifras", () => {
  it("detecta números que no estaban en los datos", () => {
    expect(numerosInventados("Los reels de armado rinden +38 % y los de vapor +25 %", [38, 25])).toEqual([])
    expect(numerosInventados("Rinden +38 % (y el jazz +60 %)", [38])).toEqual(["60"])
    expect(numerosInventados("Pedí 3 tomas de 10 s", [])).toEqual([]) // números chicos de indicaciones
  })
})

describe("semana", () => {
  it("lunes de la semana en Buenos Aires", () => {
    expect(lunesDe(new Date("2026-10-08T15:00:00Z"))).toBe("2026-10-05") // jueves
    expect(lunesDe(new Date("2026-10-05T02:00:00Z"))).toBe("2026-09-28") // domingo 23 h en AR
    expect(lunesDe(new Date("2026-10-05T12:00:00Z"))).toBe("2026-10-05")
  })
})

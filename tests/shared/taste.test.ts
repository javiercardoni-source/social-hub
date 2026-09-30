import { describe, expect, it } from "vitest"
import { backtest, desgaste, efectosRasgos, efectoTema, liftsPorMetrica, puntaje, rasgosDeTema, ridge, type PostGusto } from "../../shared/cos/taste"

const dia = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString()
let seed = 11
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

/** Posts de una cuenta; `alcance` según sus rasgos. */
function posts(n: number, rasgos: (i: number) => PostGusto["rasgos"], alcance: (r: PostGusto["rasgos"], i: number) => number, extra: (i: number) => Partial<PostGusto> = () => ({})): PostGusto[] {
  return Array.from({ length: n }, (_, i) => {
    const r = rasgos(i)
    const a = alcance(r, i)
    return { id: `p${i}`, account: "ig", format: "reel" as const, postedAt: dia(i), metrics: { reach: a, views: a, likes: a / 10, comments: a / 100, saved: 0, shares: 0 }, rasgos: r, ...extra(i) }
  })
}

describe("lifts por métrica", () => {
  it("relativos a su época y formato, acotados, y la franja se descuenta de las vistas", () => {
    const ps = posts(20, () => ({}), (_, i) => (i === 10 ? 10_000 : 100))
    const l = liftsPorMetrica(ps)
    expect(l.get("p3")!.vistas).toBe(1)
    expect(l.get("p10")!.vistas).toBe(4) // viral acotado
    const conFranja = liftsPorMetrica(posts(20, () => ({}), () => 100, (i) => ({ franja: i === 5 ? 2 : 1 })))
    expect(conFranja.get("p5")!.vistas).toBe(0.5) // rindió como siempre en una franja que rinde el doble
  })
  it("interacción = (likes + 2 comentarios + 3 guardados + 3 compartidos) / alcance", () => {
    const ps = posts(10, () => ({}), () => 100)
    ps[0].metrics = { reach: 100, likes: 20, comments: 5, saved: 0, shares: 0 }
    const l = liftsPorMetrica(ps)
    expect(l.get("p0")!.interaccion).toBeGreaterThan(1)
  })
})

describe("puntaje por objetivo", () => {
  it("media geométrica ponderada de lo que hay", () => {
    expect(puntaje({ vistas: 2, interaccion: 0.5 }, "gusta")).toBeCloseTo(1, 5)
    expect(puntaje({ vistas: 2, interaccion: 2 }, "gusta")).toBeCloseTo(2, 5)
    expect(puntaje({ vistas: 2 }, "crece")).toBeNull()
    expect(puntaje(undefined, "gusta")).toBeNull()
  })
})

describe("efecto de los rasgos", () => {
  it("un rasgo que rinde de verdad (muchos posts) es claro; con 1 o 2 posts no manda", () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ rasgos: { plano: i % 2 ? "cenital" : "medio", accion: i < 2 ? "vapor" : "nada" }, score: (i % 2 ? 1.5 : 1) * (i < 2 ? 3 : 1) }))
    const ef = efectosRasgos(items)
    const cenital = ef.find((e) => e.campo === "plano" && e.valor === "cenital")!
    const vapor = ef.find((e) => e.valor === "vapor")!
    expect(cenital.claro).toBe(true)
    expect(cenital.efecto).toBeGreaterThan(1.1)
    expect(vapor.claro).toBe(false)
    expect(vapor.confianza).toBe("baja")
  })
  it("sin datos: nada", () => {
    expect(efectosRasgos([])).toEqual([])
  })
  it("avisa cuando un rasgo va casi siempre junto con otro (posible confusión)", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ rasgos: { genero: i < 30 ? "jazz" : "house", plano: i < 30 ? "cenital" : i % 2 ? "medio" : "ambiente" }, score: i < 30 ? 1.4 : 1 }))
    expect(efectosRasgos(items).find((e) => e.valor === "jazz")!.junto_con).toBe("plano: cenital")
  })
  it("ridge separa rasgos que van juntos (≥150 posts)", () => {
    // El jazz no hace nada: lo que rinde es el cenital, y el jazz va casi siempre con cenital.
    const items = Array.from({ length: 400 }, () => {
      const cenital = rnd() < 0.5
      const jazz = cenital ? rnd() < 0.8 : rnd() < 0.2
      return { rasgos: { plano: cenital ? "cenital" : "medio", genero: jazz ? "jazz" : "house" }, score: cenital ? 1.5 : 1 }
    })
    const simple = efectosRasgos(items).find((e) => e.valor === "jazz")!.efecto
    const r = ridge(items)!
    expect(simple).toBeGreaterThan(1.1) // el efecto simple se confunde
    expect(Math.abs(r.coef["genero=jazz"] - 1)).toBeLessThan(Math.abs(simple - 1)) // ridge lo corrige
    expect(r.coef["plano=cenital"]).toBeGreaterThan(r.coef["plano=medio"])
    expect(ridge(items.slice(0, 100))).toBeNull()
  })
})

describe("música", () => {
  it("rasgos de un tema por tramos", () => {
    expect(rasgosDeTema({ genre: "jazz", mood: ["relajado"], vocals: false, bpm: 118, energy: 0.72 })).toEqual({ genero: "jazz", mood: "relajado", voz: "instrumental", bpm: "medio", energia: "media" })
    expect(rasgosDeTema({ genre: null, mood: [], vocals: null, bpm: null, energy: null }).bpm).toBeNull()
  })
  it("un tema nuevo hereda de sus rasgos; con historia propia se le cree más", () => {
    const ef = [{ campo: "genero", valor: "jazz", efecto: 1.2, n: 40, lo: 1.1, hi: 1.3, confianza: "alta" as const, claro: true }]
    const nuevo = efectoTema({ suma: 0, n: 0 }, { genero: "jazz" }, ef)
    expect(nuevo.efecto).toBeCloseTo(1.2, 2)
    const malo = efectoTema({ suma: Math.log(0.5) * 30, n: 30 }, { genero: "jazz" }, ef)
    expect(malo.efecto).toBeLessThan(0.8)
  })
  it("desgaste: lo repetido pierde, con piso", () => {
    expect(desgaste(0)).toBe(1)
    expect(desgaste(2)).toBe(0.9)
    expect(desgaste(20)).toBe(0.7)
  })
})

describe("backtest", () => {
  it("si los rasgos predicen, gana a la mediana; si es ruido, no", () => {
    const conSenal = Array.from({ length: 400 }, (_, i) => {
      const c = rnd() < 0.5
      return { rasgos: { plano: c ? "cenital" : "medio" }, score: (c ? 1.6 : 0.8) * (0.9 + rnd() * 0.2), postedAt: dia(i) }
    })
    const ruido = Array.from({ length: 400 }, (_, i) => ({ rasgos: { plano: rnd() < 0.5 ? "cenital" : "medio" }, score: Math.exp((rnd() - 0.5) * 1.2), postedAt: dia(i) }))
    expect(backtest(conSenal).gana).toBe(true)
    expect(backtest(ruido).gana).toBe(false)
  })
  it("con poca data no declara ganador", () => {
    expect(backtest([{ rasgos: {}, score: 1, postedAt: dia(1) }]).gana).toBe(false)
  })
})

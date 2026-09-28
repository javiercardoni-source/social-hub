import { describe, expect, it } from "vitest"
import { arSlot, explorationHint, liftText, lifts, median, slotModel, suggestSlots, type PerfPost } from "../../shared/cos/timing"

// 2026-09-28 es lunes. 23:30 UTC = 20:30 en Buenos Aires.
const ar = (day: number, hour: number) => new Date(Date.UTC(2026, 8, day, hour + 3, 0)).toISOString()

describe("arSlot (hora de Buenos Aires)", () => {
  it("convierte UTC a Buenos Aires, incluso cruzando la medianoche", () => {
    expect(arSlot("2026-09-28T23:30:00Z")).toEqual({ dow: 1, hour: 20 })
    expect(arSlot("2026-09-29T01:30:00Z")).toEqual({ dow: 1, hour: 22 }) // sigue siendo lunes en AR
    expect(arSlot("2026-09-29T03:00:00Z")).toEqual({ dow: 2, hour: 0 })
  })
})

describe("lifts", () => {
  it("compara contra la mediana de su propio formato", () => {
    const posts: PerfPost[] = [
      { postedAt: ar(1, 20), format: "feed", reach: 100 },
      { postedAt: ar(2, 20), format: "feed", reach: 200 },
      { postedAt: ar(3, 20), format: "feed", reach: 300 },
      { postedAt: ar(4, 20), format: "reel", reach: 5000 },
    ]
    const l = lifts(posts)
    expect(l.find((x) => x.post.reach === 200)!.lift).toBe(1)
    expect(l.find((x) => x.post.format === "reel")!.lift).toBe(1) // el reel no se compara con los posts
  })
  it("un viral queda acotado (no define una franja)", () => {
    const posts: PerfPost[] = [100, 100, 100, 100_000].map((r, i) => ({ postedAt: ar(1 + i, 20), format: "feed" as const, reach: r }))
    expect(Math.max(...lifts(posts).map((x) => x.lift))).toBe(4)
  })
  it("mediana de lista vacía = 0 y posts sin base se descartan", () => {
    expect(median([])).toBe(0)
    expect(lifts([{ postedAt: ar(1, 20), format: "feed", reach: 0 }])).toEqual([])
  })
})

describe("slotModel", () => {
  it("una franja con un solo post muy bueno no manda: se contrae hacia lo esperado", () => {
    const base: PerfPost[] = Array.from({ length: 30 }, (_, i) => ({ postedAt: ar(1 + (i % 7), 12 + (i % 5)), format: "feed" as const, reach: 100 }))
    const m = slotModel([...base, { postedAt: ar(5, 21), format: "feed", reach: 400 }])
    expect(m.grid[5][21]).toBeGreaterThan(1)
    expect(m.grid[5][21]).toBeLessThan(2) // lift crudo 4, contraído
  })
  it("una franja buena de verdad (muchos posts) sí sube", () => {
    const posts: PerfPost[] = [
      ...Array.from({ length: 20 }, (_, i) => ({ postedAt: ar(1 + (i % 7), 12), format: "feed" as const, reach: 100 })),
      ...Array.from({ length: 12 }, (_, i) => ({ postedAt: ar(1 + (i % 7), 20), format: "feed" as const, reach: 300 })),
    ]
    const m = slotModel(posts)
    expect(m.hour[20]).toBeGreaterThan(m.hour[12])
  })
  it("una cuenta que creció no hace ganar a la franja nueva solo por tener más seguidores", () => {
    const day = (n: number, hour: number) => new Date(Date.UTC(2026, 0, 1 + n, hour + 3)).toISOString()
    // Época vieja: publicaba a las 12 con 100 de alcance. Época nueva (10x seguidores): a las 20 con 1000.
    const posts: PerfPost[] = [
      ...Array.from({ length: 20 }, (_, i) => ({ postedAt: day(i * 3, 12), format: "feed" as const, reach: 100 })),
      ...Array.from({ length: 20 }, (_, i) => ({ postedAt: day(200 + i * 3, 20), format: "feed" as const, reach: 1000 })),
    ]
    const m = slotModel(posts)
    expect(Math.abs(m.hour[20] - m.hour[12])).toBeLessThan(0.15)
  })

  it("sin datos: todo en 1 (neutro)", () => {
    const m = slotModel([])
    expect(m.n).toBe(0)
    expect(m.grid[3][15]).toBe(1)
  })
})

describe("suggestSlots", () => {
  const posts: PerfPost[] = [
    ...Array.from({ length: 30 }, (_, i) => ({ postedAt: ar(1 + (i % 7), 12), format: "feed" as const, reach: 100 })),
    ...Array.from({ length: 30 }, (_, i) => ({ postedAt: ar(1 + (i % 7), 20), format: "feed" as const, reach: 250 })),
  ]
  const m = slotModel(posts)
  const from = new Date("2026-09-28T18:10:00Z") // lunes 15:10 en AR

  it("nunca sugiere algo en el pasado ni en la próxima hora", () => {
    for (const s of suggestSlots(m, { from, count: 10 })) expect(new Date(s.at).getTime()).toBeGreaterThanOrEqual(from.getTime() + 3600_000)
  })
  it("prefiere la franja que rinde más y la muestra en hora de Buenos Aires", () => {
    const [s] = suggestSlots(m, { from })
    expect(s.hour).toBe(20)
    expect(arSlot(s.at).hour).toBe(20)
    expect(s.label).toMatch(/20:00$/)
    expect(s.confianza).toBe("alta")
  })
  it("no amontona dos sugerencias a menos de 3 horas", () => {
    const s = suggestSlots(m, { from, count: 5 }).map((x) => new Date(x.at).getTime()).sort()
    for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeGreaterThanOrEqual(3 * 3600_000)
  })
  it("respeta los días permitidos (ej. FasutoFudo abre martes a sábado)", () => {
    for (const s of suggestSlots(m, { from, count: 6, allowedDays: [2, 3, 4, 5, 6] })) expect([2, 3, 4, 5, 6]).toContain(s.dow)
  })
  it("con poca data avisa confianza baja", () => {
    const poco = slotModel(posts.slice(0, 5))
    expect(suggestSlots(poco, { from })[0].confianza).toBe("baja")
  })
})

describe("evidencia y exploración", () => {
  // Cuenta que publicó SIEMPRE a las 19 (como Sensaciones).
  const posts: PerfPost[] = Array.from({ length: 60 }, (_, i) => ({
    postedAt: new Date(Date.UTC(2026, 5, 1 + i, 22)).toISOString(),
    format: "feed" as const,
    reach: i % 7 === 0 ? 300 : 100,
  }))
  const m = slotModel(posts)
  it("no sugiere horas sin evidencia (sería extrapolar)", () => {
    for (const s of suggestSlots(m, { from: new Date("2026-09-28T12:00:00Z"), count: 5 })) expect([18, 19, 20]).toContain(s.hour)
  })
  it("detecta que la cuenta está concentrada en una hora y propone probar otras", () => {
    const e = explorationHint(m)
    expect(e.concentrada).toBe(true)
    expect(e.habitual).toEqual([19])
    expect(e.probar.length).toBeGreaterThan(0)
    expect(e.probar).not.toContain(19)
  })
})

describe("feriados", () => {
  it("un feriado se comporta como domingo al aprender y al sugerir", () => {
    const fer = new Set(["2026-10-12"]) // lunes feriado
    expect(arSlot("2026-10-12T23:00:00Z", fer).dow).toBe(0)
    expect(arSlot("2026-10-12T23:00:00Z").dow).toBe(1)
    // Los domingos a las 20 rinden mucho: el lunes feriado a las 20 también debería sugerirse.
    const posts: PerfPost[] = [
      ...Array.from({ length: 20 }, (_, i) => ({ postedAt: new Date(Date.UTC(2026, 8, 6 + i * 7, 23)).toISOString(), format: "feed" as const, reach: 400 })),
      ...Array.from({ length: 40 }, (_, i) => ({ postedAt: new Date(Date.UTC(2026, 8, 1 + (i % 5) + Math.floor(i / 5) * 7, 23)).toISOString(), format: "feed" as const, reach: 100 })),
    ]
    const m = slotModel(posts)
    const s = suggestSlots(m, { from: new Date("2026-10-12T12:00:00Z"), days: 1, count: 1, holidays: fer })
    expect(s[0].dow).toBe(0)
    expect(s[0].hour).toBe(20)
    expect(s[0].label).toBe("lunes (feriado) 20:00")
  })
})

describe("liftText", () => {
  it("formatea el rendimiento", () => {
    expect(liftText(1.38)).toBe("+38 %")
    expect(liftText(0.88)).toBe("−12 %")
    expect(liftText(1.01)).toBe("como siempre")
  })
})

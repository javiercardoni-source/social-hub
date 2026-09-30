import { describe, expect, it } from "vitest"
import {
  abreEseDia,
  asignar,
  cabe,
  climaDeHora,
  deBA,
  efectosContexto,
  enBA,
  esperado,
  modeloAgenda,
  normalizarApertura,
  pct,
  primerTurno,
  primerHuecoManual,
  validarPropuesta,
  type Apertura,
  type ModeloAgenda,
  type Pieza,
  type PostCtx,
  type Reglas,
} from "../../shared/cos/agenda"
import { slotModel } from "../../shared/cos/timing"

// 2026-10-05 es lunes.
const LUNES = "2026-10-05"
const ar = (dia: string, h: number, m = 0) => deBA(dia, h * 60 + m)
const dia = (n: number) => new Date(Date.parse(`${LUNES}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** Posts de feed repartidos en horas y días, con alcance base 100 (y lo que se pida). */
function historia(n: number, alcance: (i: number) => number = () => 100, ctx: (i: number) => PostCtx["contexto"] = () => ({ clima: "nublado", feriado: false })): PostCtx[] {
  return Array.from({ length: n }, (_, i) => ({ postedAt: ar(dia(-(i % 50) - 1), 11 + (i % 10)).toISOString(), format: "feed" as const, reach: alcance(i), contexto: ctx(i) }))
}

const plano = (): ModeloAgenda => modeloAgenda(historia(60), historia(60))
const reglas = (x: Partial<Reglas> = {}): Reglas => ({ desde: ar(LUNES, 8), dias: 7, horaMin: 9, horaMax: 22, apertura: null, explorarCada: 0, ...x })

describe("hora de Buenos Aires", () => {
  it("deBA / enBA van y vuelven (UTC−3)", () => {
    const at = deBA(LUNES, 19 * 60 + 30)
    expect(at.toISOString()).toBe("2026-10-05T22:30:00.000Z")
    expect(enBA(at)).toEqual({ dia: LUNES, dow: 1, min: 19 * 60 + 30 })
    expect(enBA(new Date("2026-10-06T01:30:00Z")).dia).toBe(LUNES) // 22:30 del lunes en AR
  })
})

describe("clima por hora", () => {
  it("categorías que cambian el mensaje", () => {
    expect(climaDeHora({ code: 95, temp: 20 })).toBe("tormenta")
    expect(climaDeHora({ code: 3, temp: 20, precip_mm: 1.2 })).toBe("lluvia")
    expect(climaDeHora({ code: 61, temp: 20 })).toBe("lluvia")
    expect(climaDeHora({ code: 0, temp: 8 })).toBe("frio")
    expect(climaDeHora({ code: 0, temp: 33 })).toBe("calor")
    expect(climaDeHora({ code: 1, temp: 22 })).toBe("soleado")
    expect(climaDeHora({ code: 3, temp: 22 })).toBe("nublado")
  })
})

describe("lo que se aprende del contexto", () => {
  const slot = (p: PostCtx[]) => slotModel(p)

  it("si los días de lluvia rinden más de verdad (muchos posts), el efecto es claro", () => {
    const posts = historia(200, (i) => (i % 4 === 0 ? 170 : 100), (i) => ({ clima: i % 4 === 0 ? "lluvia" : "nublado", feriado: false }))
    const e = efectosContexto(posts, slot(posts)).find((x) => x.factor === "lluvia")!
    expect(e.claro).toBe(true)
    expect(e.efecto).toBeGreaterThan(1.1)
    expect(e.n).toBe(50)
  })

  it("con pocos posts no manda (contraído y sin efecto claro)", () => {
    const posts = historia(60, (i) => (i < 3 ? 400 : 100), (i) => ({ clima: i < 3 ? "tormenta" : "nublado", feriado: false }))
    const e = efectosContexto(posts, slot(posts)).find((x) => x.factor === "tormenta")!
    expect(e.claro).toBe(false)
    expect(e.efecto).toBeLessThan(2) // lift crudo 4, contraído
  })

  it("si no cambia nada, lo dice (sin efecto claro)", () => {
    const posts = historia(200, () => 100, (i) => ({ clima: i % 2 ? "soleado" : "nublado", feriado: i % 5 === 0 }))
    const ef = efectosContexto(posts, slot(posts))
    expect(ef.find((x) => x.factor === "soleado")!.claro).toBe(false)
    expect(ef.find((x) => x.factor === "feriado")!.claro).toBe(false)
  })

  it("el esperado solo usa efectos claros", () => {
    const posts = historia(200, (i) => (i % 4 === 0 ? 170 : 100), (i) => ({ clima: i % 4 === 0 ? "lluvia" : "nublado", feriado: false }))
    const m = modeloAgenda(posts, posts)
    const conLluvia = esperado(m, ar(LUNES, 20), { clima: "lluvia", feriado: false })
    const sin = esperado(m, ar(LUNES, 20), { clima: "nublado", feriado: false })
    expect(conLluvia.lift).toBeGreaterThan(sin.lift)
    expect(conLluvia.por.join(" ")).toMatch(/llueve/)
    // Sin un efecto claro para ese clima, no se aplica nada.
    const m2 = modeloAgenda(historia(60), historia(60))
    expect(esperado(m2, ar(LUNES, 20), { clima: "tormenta", feriado: false }).por).toEqual([])
  })

  it("pooling: con poca historia propia se apoya en todas las cuentas", () => {
    expect(modeloAgenda(historia(10), historia(200)).peso).toBeCloseTo(10 / 40, 2)
    expect(modeloAgenda(historia(150), historia(200)).peso).toBeGreaterThan(0.8)
  })
})

describe("apertura", () => {
  const ap = normalizarApertura({ "2": [{ desde: "19:00", hasta: "23:30" }], "5": [{ desde: "9:00", hasta: "15:00" }, { desde: "19:00", hasta: "24:00" }], "3": [{ desde: "mal", hasta: "x" }] })!
  it("normaliza y descarta lo que no se entiende", () => {
    expect(ap["5"][0].desde).toBe("09:00")
    expect(ap["3"]).toEqual([])
    expect(normalizarApertura({ "1": [] })).toBeNull()
    expect(normalizarApertura("lunes a viernes")).toBeNull()
  })
  it("días que abre y primer turno", () => {
    expect(abreEseDia(ap, 2)).toBe(true)
    expect(abreEseDia(ap, 1)).toBe(false)
    expect(abreEseDia(null, 1, [2, 3])).toBe(false)
    expect(abreEseDia(null, 1)).toBe(true)
    expect(primerTurno(ap, 5)).toBe(9 * 60)
    expect(primerTurno(ap, 1)).toBeNull()
  })
})

describe("asignar", () => {
  const post = (id: string, x: Partial<Pieza> = {}): Pieza => ({ id, account: "ig", format: "reel", ...x })

  it("siempre dentro de 9–22, en el futuro y en días que abre", () => {
    const ap: Apertura = { "0": [], "1": [], "2": [{ desde: "19:00", hasta: "23:00" }], "3": [{ desde: "19:00", hasta: "23:00" }], "4": [], "5": [], "6": [] }
    const { asignadas } = asignar([post("a"), post("b")], plano, [], reglas({ apertura: ap }))
    for (const a of asignadas) {
      const { dow, min } = enBA(new Date(a.at))
      expect([2, 3]).toContain(dow)
      expect(min).toBeGreaterThanOrEqual(9 * 60)
      expect(min).toBeLessThanOrEqual(22 * 60)
      expect(Date.parse(a.at)).toBeGreaterThan(ar(LUNES, 8).getTime())
    }
  })

  it("posts: máximo 1 por día por cuenta (y 4 h entre sí); historias: 5 por día y 90 min", () => {
    const { asignadas } = asignar([post("a"), post("b"), post("c")], plano, [], reglas())
    expect(new Set(asignadas.map((a) => enBA(new Date(a.at)).dia)).size).toBe(3)
    const hist = Array.from({ length: 7 }, (_, i) => post(`h${i}`, { format: "story", dia: dia(1) }))
    const r = asignar(hist, plano, [], reglas())
    expect(r.asignadas).toHaveLength(5)
    expect(r.sinLugar).toHaveLength(2)
    const ts = r.asignadas.map((a) => Date.parse(a.at)).sort((x, y) => x - y)
    for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeGreaterThanOrEqual(90 * 60_000)
  })

  it("cuentas distintas no se estorban", () => {
    const { asignadas } = asignar([post("a", { account: "ig" }), post("b", { account: "fb" })], plano, [], reglas({ dias: 0 }))
    expect(asignadas).toHaveLength(2)
  })

  it("respeta lo ya ocupado (fijado a mano)", () => {
    const ocupado = { account: "ig", format: "reel" as const, at: ar(dia(1), 20).toISOString() }
    const { asignadas } = asignar([post("a", { dia: dia(1) })], plano, [ocupado], reglas())
    expect(asignadas).toHaveLength(0)
  })

  it("día fijo (feriado) → ese día, fuente 'fijo' y ventana de ese día", () => {
    const { asignadas } = asignar([post("f", { dia: dia(3), format: "story" })], plano, [], reglas())
    expect(enBA(new Date(asignadas[0].at)).dia).toBe(dia(3))
    expect(asignadas[0].fuente).toBe("fijo")
    expect(enBA(new Date(asignadas[0].ventana.desde)).dia).toBe(dia(3))
    expect(enBA(new Date(asignadas[0].ventana.hasta)).min).toBe(22 * 60)
  })

  it("antes del servicio: una hora antes de que abra, como mucho", () => {
    const ap: Apertura = Object.fromEntries(Array.from({ length: 7 }, (_, d) => [String(d), [{ desde: "18:00", hasta: "23:00" }]]))
    const { asignadas } = asignar([post("c", { format: "story", dia: dia(1), antesDelServicio: true })], plano, [], reglas({ apertura: ap }))
    expect(enBA(new Date(asignadas[0].at)).min).toBeLessThanOrEqual(17 * 60)
  })

  it("lo aprobado con ventana: se mueve solo dentro de ella y a más de 3 h", () => {
    const v = { desde: ar(LUNES, 9).toISOString(), hasta: ar(LUNES, 12).toISOString() }
    const { asignadas, sinLugar } = asignar([post("v", { ventana: v })], plano, [], reglas({ desde: ar(LUNES, 8) }))
    expect(sinLugar).toHaveLength(0)
    const at = Date.parse(asignadas[0].at)
    expect(at).toBeGreaterThanOrEqual(ar(LUNES, 11).getTime()) // 8 + 3 h
    expect(at).toBeLessThanOrEqual(Date.parse(v.hasta))
    expect(asignadas[0].ventana).toEqual(v)
  })

  it("elige la franja que mejor rinde", () => {
    const buena = historia(120, (i) => (11 + (i % 10) === 19 ? 300 : 100))
    const m = () => modeloAgenda(buena, buena)
    const { asignadas } = asignar([post("x", { dia: dia(1) })], m, [], reglas())
    expect(enBA(new Date(asignadas[0].at)).min).toBe(19 * 60)
    expect(asignadas[0].porque).toMatch(/sobre tu promedio/)
  })

  it("si ya tenía una hora que rinde casi igual, no la mueve", () => {
    const actual = ar(dia(2), 15).toISOString()
    const { asignadas } = asignar([post("x", { actual })], plano, [], reglas())
    expect(asignadas[0].at).toBe(actual)
  })

  it("exploración: más o menos 1 de cada 6, y siempre la misma pieza (estable)", () => {
    const piezas = Array.from({ length: 120 }, (_, i) => post(`p${i}`, { account: `c${i}` }))
    const r1 = asignar(piezas, plano, [], reglas({ explorarCada: 6 }))
    const r2 = asignar(piezas, plano, [], reglas({ explorarCada: 6 }))
    const n = r1.asignadas.filter((a) => a.fuente === "exploracion").length
    expect(n).toBeGreaterThan(8)
    expect(n).toBeLessThan(35)
    expect(r1.asignadas.map((a) => a.fuente)).toEqual(r2.asignadas.map((a) => a.fuente))
    // Día fijo o ventana aprobada: nunca se explora.
    const fijas = asignar(piezas.map((p) => ({ ...p, dia: dia(1) })), plano, [], reglas({ explorarCada: 6 }))
    expect(fijas.asignadas.every((a) => a.fuente === "fijo")).toBe(true)
  })
})

describe("lo que propone el agente", () => {
  const piezas: Pieza[] = [
    { id: "a", account: "ig", format: "reel" },
    { id: "b", account: "ig", format: "reel" },
  ]
  const r = reglas({ apertura: { ...Object.fromEntries(Array.from({ length: 7 }, (_, d) => [String(d), [{ desde: "19:00", hasta: "23:00" }]])), "0": [] } })
  const base = asignar(piezas, plano, [], r).asignadas

  it("aplica lo válido y descarta lo que rompe una regla, con el motivo", () => {
    const domingo = ar(dia(6), 20).toISOString()
    const valida = ar(dia(4), 20).toISOString()
    const mismoDia = new Date(Date.parse(valida) - 5 * 3600_000).toISOString()
    const { plan, descartadas } = validarPropuesta(
      [
        { post_id: "a", at: valida, porque: "jueves de lluvia" },
        { post_id: "b", at: mismoDia },
        { post_id: "b", at: domingo },
        { post_id: "zzz", at: valida },
        { post_id: "b", at: ar(LUNES, 8, 30).toISOString() },
        { post_id: "b", at: "mañana" },
      ],
      base,
      piezas,
      [],
      r,
    )
    expect(plan.find((x) => x.id === "a")!.at).toBe(valida)
    expect(plan.find((x) => x.id === "a")!.porque).toBe("jueves de lluvia")
    expect(descartadas.map((d) => d.motivo)).toEqual([expect.stringMatching(/ese día|cerca/), "la marca no abre ese día", "no es una pieza de esta agenda", "en el pasado o demasiado pronto", "fecha inválida"])
    expect(plan.find((x) => x.id === "b")).toEqual(base.find((x) => x.id === "b"))
  })

  it("cabe() explica por qué no", () => {
    expect(cabe({ id: "x", account: "ig", format: "reel" }, ar(LUNES, 23), [], reglas())).toMatch(/9–22/)
  })
})

describe("textos", () => {
  it("porcentajes", () => {
    expect(pct(1.28)).toBe("+28 %")
    expect(pct(0.88)).toBe("−12 %")
    expect(pct(1.01)).toBe("como siempre")
  })
})

describe("historias de clima (decisión de Javier)", async () => {
  const { historiaDeClima, CONSIGNAS_CLIMA } = await import("../../shared/cos/agenda")
  it("lluvia y tormenta: siempre (aviso honesto), aunque ayer también lloviera", () => {
    expect(historiaDeClima("lluvia", "lluvia")).toBe("lluvia")
    expect(historiaDeClima("tormenta", "lluvia")).toBe("tormenta")
  })
  it("sol, frío o calor: solo si cambió respecto de ayer; nublado: nada", () => {
    expect(historiaDeClima("soleado", "lluvia")).toBe("soleado")
    expect(historiaDeClima("soleado", "soleado")).toBeNull()
    expect(historiaDeClima("frio", null)).toBe("frio")
    expect(historiaDeClima("nublado", "lluvia")).toBeNull()
    expect(historiaDeClima(null, "lluvia")).toBeNull()
  })
  it("el aviso de lluvia menciona la demora por la calzada mojada y nunca promete tiempos", () => {
    expect(CONSIGNAS_CLIMA.lluvia.consigna).toMatch(/calzada mojada/)
    for (const c of Object.values(CONSIGNAS_CLIMA)) expect(c.respaldo.length).toBeLessThanOrEqual(60)
  })
})

describe("honestidad del porqué", () => {
  it("con poca historia lo dice", () => {
    const poca = () => modeloAgenda(historia(5), historia(5))
    const { asignadas } = asignar([{ id: "x", account: "ig", format: "reel", dia: dia(1) }], poca, [], reglas())
    // Día fijo: no es 'motor', no lleva la aclaración; sin día fijo sí.
    const libre = asignar([{ id: "y", account: "ig", format: "reel" }], poca, [], reglas()).asignadas[0]
    expect(libre.porque).toMatch(/poca data/)
    expect(asignadas[0].porque).not.toMatch(/poca data/)
  })
})

describe("exploración con pooling", () => {
  it("una cuenta que siempre publicó a la misma hora explora aunque otras cuentas tengan esas horas cubiertas", () => {
    const soloALas20 = Array.from({ length: 70 }, (_, i) => ({ postedAt: ar(dia(-(i % 60) - 1), 20).toISOString(), format: "feed" as const, reach: 100, contexto: null }))
    const m = () => modeloAgenda(soloALas20, [...soloALas20, ...historia(300)])
    const piezas = Array.from({ length: 60 }, (_, i) => ({ id: `b${i}`, account: `c${i}`, format: "reel" as const }))
    const n = asignar(piezas, m, [], reglas({ explorarCada: 6 })).asignadas.filter((a) => a.fuente === "exploracion").length
    expect(n).toBeGreaterThan(4)
  })
})

describe("primerHuecoManual (freno anti-ráfaga de lo aprobado a mano)", () => {
  const T = Date.parse("2026-10-01T19:00:00Z")
  const at = (min: number) => new Date(T + min * 60_000).toISOString()
  it("sin nada cerca, sale a la hora pedida", () => {
    const r = primerHuecoManual({ account: "a", format: "feed" }, new Date(T), [{ account: "a", format: "story", at: at(0) }, { account: "b", format: "feed", at: at(0) }])
    expect(r).toEqual({ at: new Date(T), corrido: false })
  })
  it("feed y reel comparten la separación de 4 h", () => {
    const r = primerHuecoManual({ account: "a", format: "reel" }, new Date(T), [{ account: "a", format: "feed", at: at(-30) }])
    expect(r.corrido).toBe(true)
    expect(r.at.getTime()).toBe(T + 210 * 60_000)
  })
  it("nueve aprobadas de golpe quedan escalonadas", () => {
    const ocupados: { account: string; format: "feed" | "story"; at: string }[] = []
    const salidas: number[] = []
    for (let i = 0; i < 3; i++) {
      const r = primerHuecoManual({ account: "a", format: "story" }, new Date(T), ocupados)
      ocupados.push({ account: "a", format: "story", at: r.at.toISOString() })
      salidas.push((r.at.getTime() - T) / 60_000)
    }
    expect(salidas).toEqual([0, 90, 180])
  })
  it("salta varios choques seguidos", () => {
    const r = primerHuecoManual({ account: "a", format: "story" }, new Date(T), [
      { account: "a", format: "story", at: at(10) },
      { account: "a", format: "story", at: at(100) },
    ])
    expect((r.at.getTime() - T) / 60_000).toBe(190)
  })
})

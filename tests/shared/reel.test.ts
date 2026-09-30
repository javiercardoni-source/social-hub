import { describe, expect, it } from "vitest"
import { CIERRE, CORTE, FUNDIDO, lineaDeTiempo, normalizarGuion, TOMA_MAX } from "../../shared/cos/reel"

const fuentes = [
  { tipo: "video" as const, duracion: 10 },
  { tipo: "foto" as const, duracion: null },
  { tipo: "video" as const, duracion: 0.5 },
]

describe("normalizarGuion", () => {
  it("deja las tomas dentro del video y con largo razonable", () => {
    const g = normalizarGuion({ tomas: [{ fuente: 0, trim_start: 9.5, duracion: 5, movimiento: "acercar" }] }, fuentes)
    expect(g.tomas[0].duracion).toBe(TOMA_MAX)
    expect(g.tomas[0].trim_start).toBeCloseTo(10 - TOMA_MAX)
  })
  it("tira tomas de fuentes que no existen o videos demasiado cortos", () => {
    const g = normalizarGuion({ tomas: [{ fuente: 7 }, { fuente: 2 }, { fuente: 1.5 }, { fuente: 1 }] }, fuentes)
    expect(g.tomas.map((t) => t.fuente)).toEqual([1])
  })
  it("las fotos no tienen trim y la primera toma entra en corte", () => {
    const g = normalizarGuion({ tomas: [{ fuente: 1, trim_start: 4, transicion: "fundido" }, { fuente: 0, transicion: "fundido" }] }, fuentes)
    expect(g.tomas[0]).toMatchObject({ trim_start: 0, transicion: "corte" })
    expect(g.tomas[1].transicion).toBe("fundido")
  })
  it("textos cortos en mayúsculas sin emojis; recuadro solo de la lista; música que exista", () => {
    const g = normalizarGuion(
      { tomas: [{ fuente: 1 }], gancho: "noche de sushi 🍣 #promo", recuadro: "HASTA AGOTAR STOCK", musica: "otra.mp3" },
      fuentes,
      ["a.mp3", "b.mp3"],
    )
    expect(g.gancho).toBe("NOCHE DE SUSHI")
    expect(g.recuadro).toBe("")
    expect(g.musica).toBe("a.mp3")
    expect(g.medio).toBe("") // menos de 3 tomas: no hay texto del medio
  })
})

describe("lineaDeTiempo", () => {
  it("superpone fundidos y cortes y agrega el cierre", () => {
    const l = lineaDeTiempo([
      { duracion: 2, transicion: "corte" },
      { duracion: 2, transicion: "fundido" },
      { duracion: 2, transicion: "corte" },
    ])
    expect(l.inicios[1]).toBeCloseTo(2 - FUNDIDO)
    expect(l.inicios[2]).toBeCloseTo(2 - FUNDIDO + 2 - CORTE)
    expect(l.total).toBeCloseTo(l.inicios[2] + 2 - FUNDIDO + CIERRE)
  })
})

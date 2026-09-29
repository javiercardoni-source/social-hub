import { describe, expect, it } from "vitest"
import { consignaFeriado, diasAntesDe, horaBA, planFeriado } from "../../shared/cos/feriados"

describe("planFeriado", () => {
  it("cuenta regresiva: 48 h antes, 24 h antes y el feriado", () => {
    const p = planFeriado("2026-11-23") // lunes, sin dato de días: abre todos
    expect(p.map((x) => [x.tipo, x.diasAntes])).toEqual([
      ["reserva", 2],
      ["ultima_llamada", 1],
      ["ultimo_momento", 0],
    ])
  })

  it("si la marca no abre ese día, no se anuncia", () => {
    // 12/10/2026 es lunes; FasutoFudo abre de martes a sábado.
    expect(planFeriado("2026-10-12", [2, 3, 4, 5, 6])).toEqual([])
    expect(planFeriado("2026-12-08", [2, 3, 4, 5, 6]).length).toBe(3) // martes: abre
  })

  it("Navidad y Año nuevo: solo el saludo, abra o no", () => {
    expect(planFeriado("2026-12-25", [2, 3, 4, 5, 6])).toEqual([{ orden: 1, tipo: "saludo", diasAntes: 0, hora: "11:00" }])
    expect(planFeriado("2027-01-01").map((x) => x.tipo)).toEqual(["saludo"])
  })
})

describe("consignaFeriado", () => {
  it("la última llamada habla de hoy como último día para reservar", () => {
    expect(consignaFeriado("ultima_llamada", "Carnaval", "2027-02-08").consigna).toMatch(/último día para reservar/)
  })
  it("el anuncio es neutral y pide reservar", () => {
    const c = consignaFeriado("reserva", "Día de la Soberanía Nacional", "2026-11-23")
    expect(c.consigna).toMatch(/NEUTRAL/)
    expect(c.consigna).toMatch(/reservar/)
  })
  it("los saludos no hablan de pedidos", () => {
    expect(consignaFeriado("saludo", "Navidad", "2026-12-25").respaldo).toBe("¡Feliz Navidad!")
    expect(consignaFeriado("saludo", "Año nuevo", "2027-01-01").consigna).toMatch(/no menciones pedidos/)
  })
})

describe("diasAntesDe", () => {
  it("resta días cruzando meses y años", () => {
    expect(diasAntesDe("2026-11-23", 2)).toBe("2026-11-21")
    expect(diasAntesDe("2026-12-01", 1)).toBe("2026-11-30")
    expect(diasAntesDe("2027-01-01", 2)).toBe("2026-12-30")
  })
})

describe("horaBA", () => {
  it("la hora es de Buenos Aires", () => {
    expect(horaBA("2026-11-23", "11:30")).toBe("2026-11-23T14:30:00.000Z")
  })
})

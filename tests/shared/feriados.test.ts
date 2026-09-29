import { describe, expect, it } from "vitest"
import { consignaFeriado, horaBA, planFeriado } from "../../shared/cos/feriados"

describe("planFeriado", () => {
  it("feriado en que la marca abre: dos historias seguidas", () => {
    const p = planFeriado("2026-11-23") // lunes, sin dato de días: abre todos
    expect(p.map((x) => x.tipo)).toEqual(["reserva", "ultimo_momento"])
    expect(p[1].hora > p[0].hora).toBe(true)
  })

  it("si la marca no abre ese día, no se anuncia", () => {
    // 12/10/2026 es lunes; FasutoFudo abre de martes a sábado.
    expect(planFeriado("2026-10-12", [2, 3, 4, 5, 6])).toEqual([])
    expect(planFeriado("2026-12-08", [2, 3, 4, 5, 6]).length).toBe(2) // martes: abre
  })

  it("Navidad y Año nuevo: solo el saludo, abra o no", () => {
    expect(planFeriado("2026-12-25", [2, 3, 4, 5, 6])).toEqual([{ orden: 1, tipo: "saludo", hora: "11:00" }])
    expect(planFeriado("2027-01-01").map((x) => x.tipo)).toEqual(["saludo"])
  })
})

describe("consignaFeriado", () => {
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

describe("horaBA", () => {
  it("la hora es de Buenos Aires", () => {
    expect(horaBA("2026-11-23", "11:30")).toBe("2026-11-23T14:30:00.000Z")
  })
})

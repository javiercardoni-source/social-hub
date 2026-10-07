import { describe, expect, it } from "vitest"
import { campaniasDelDia, campaniasParaIA, validarCampania, type Campania } from "../../shared/cos/campanias"

const c = (x: Partial<Campania>): Campania => ({ id: x.nombre ?? "x", nombre: "x", tipo: "temporada", desde: "2026-09-21", hasta: "2026-12-20", objetivo: "", mensaje: "", productos: "", tono: "", color: "#22c55e", activa: true, ...x })

describe("campañas por temporada", () => {
  const lista = [c({ nombre: "Primavera", mensaje: "Sushi al aire libre" }), c({ nombre: "Día de la Madre", tipo: "comercial", desde: "2026-10-09", hasta: "2026-10-18" }), c({ nombre: "Black Friday", tipo: "comercial", desde: "2026-11-23", hasta: "2026-11-30" }), c({ nombre: "Vieja", desde: "2026-01-01", hasta: "2026-02-01" })]

  it("la fecha comercial va antes que la temporada el mismo día", () => {
    expect(campaniasDelDia(lista, "2026-10-12").map((x) => x.nombre)).toEqual(["Día de la Madre", "Primavera"])
    expect(campaniasDelDia(lista, "2026-10-07").map((x) => x.nombre)).toEqual(["Primavera"])
  })

  it("a la IA le llega la vigente y la que empieza en las próximas 3 semanas", () => {
    const t = campaniasParaIA(lista, "2026-10-07")
    expect(t).toMatch(/Vigente: Primavera .*Sushi al aire libre/)
    expect(t).toMatch(/Próxima: Día de la Madre \(09\/10 al 18\/10\)/)
    expect(t).not.toMatch(/Black Friday|Vieja/)
    expect(campaniasParaIA([], "2026-10-07")).toBe("")
  })

  it("valida lo que se carga", () => {
    expect(validarCampania({ nombre: "", desde: "2026-10-01", hasta: "2026-10-02" })).toMatch(/nombre/)
    expect(validarCampania({ nombre: "X", desde: "2026-10-05", hasta: "2026-10-01" })).toMatch(/anterior/)
    expect(validarCampania({ nombre: " Verano ", desde: "2026-12-21", hasta: "2027-03-20", tipo: "raro", color: "rojo" })).toMatchObject({ nombre: "Verano", tipo: "propia", color: "#64748b" })
  })
})

import { describe, expect, it } from "vitest"
import { DATOS_VACIOS, datosParaIA, normalizarDatos } from "../../shared/cos/datos-vigentes"

describe("normalizarDatos", () => {
  it("tolera basura y devuelve la forma vacía", () => {
    expect(normalizarDatos(null)).toEqual(DATOS_VACIOS)
    expect(normalizarDatos({ combos: "no", promos: [1, null] })).toEqual(DATOS_VACIOS)
  })

  it("recorta, descarta filas vacías y valida fechas", () => {
    const d = normalizarDatos({
      horarios: "  martes a domingo 19 a 23  ",
      combos: [{ nombre: " Puro Salmón ", precio: "$33.900" }, { nombre: "  " }],
      promos: [{ texto: "2x1 martes", hasta: "30/09" }, { texto: "", hasta: "2026-10-01" }],
      links: [{ nombre: "Puro Salmón", url: "" }],
    })
    expect(d.horarios).toBe("martes a domingo 19 a 23")
    expect(d.combos).toEqual([{ nombre: "Puro Salmón", detalle: "", precio: "$33.900", activo: true }])
    expect(d.promos).toEqual([{ texto: "2x1 martes", hasta: null }])
    expect(d.links).toEqual([])
  })
})

describe("datosParaIA", () => {
  const d = normalizarDatos({
    web: "purosalmon.sensacionesdeoriente.com",
    combos: [
      { nombre: "Puro Salmón", detalle: "40 piezas", precio: "$33.900" },
      { nombre: "Delicius" },
      { nombre: "Viejo", activo: false },
    ],
    promos: [
      { texto: "Pedí antes de las 20 y pagás menos", hasta: "2026-09-30" },
      { texto: "Vencida", hasta: "2026-09-27" },
      { texto: "Sin fecha" },
    ],
  })

  it("solo pasa combos activos y promos sin vencer", () => {
    const t = datosParaIA(d, "2026-09-28")
    expect(t).toContain("Puro Salmón — 40 piezas — $33.900")
    expect(t).toContain("Delicius — (sin precio cargado: no menciones precio)")
    expect(t).not.toContain("Viejo")
    expect(t).toContain("Pedí antes de las 20 y pagás menos (hasta el 30/09)")
    expect(t).not.toContain("Vencida")
    expect(t).toContain("Sin fecha")
  })

  it("la promo vale todo el último día y se cae al siguiente", () => {
    expect(datosParaIA(d, "2026-09-30")).toContain("pagás menos")
    expect(datosParaIA(d, "2026-10-01")).not.toContain("pagás menos")
  })

  it("sin datos cargados devuelve vacío", () => {
    expect(datosParaIA(DATOS_VACIOS, "2026-09-28")).toBe("")
  })
})

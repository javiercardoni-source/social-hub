import { describe, expect, it } from "vitest"
import { avisosTexto, nombreDescarga, problemasTextoPieza, repartirMaterial, validarPedido } from "../../shared/cos/ad-sets"

const ID = "0b8f2c1e-1a2b-4c3d-8e9f-001122334455"

describe("validarPedido", () => {
  it("arma el pedido con valores por defecto", () => {
    const p = validarPedido({ textos: "  Puro salmón 40 piezas\nComé en casa  ", fuentes: ["instagram", "archivo"] })
    expect(p).toEqual({ textos: "Puro salmón 40 piezas\nComé en casa", detalles: null, versiones: 3, formato: "ambos", fuentes: ["instagram", "archivo"], elegidos: [] })
  })

  it("rechaza sin texto, sin fuentes o con «sin TACC»", () => {
    expect(validarPedido({ textos: " ", fuentes: ["instagram"] })).toMatch(/Escribí/)
    expect(validarPedido({ textos: "Puro salmón", fuentes: [] })).toMatch(/de dónde/)
    expect(validarPedido({ textos: "Rolls sin TACC", fuentes: ["instagram"] })).toMatch(/TACC/)
    expect(validarPedido({ textos: "Puro salmón", fuentes: ["instagram"], versiones: 9 })).toMatch(/1 a 6/)
  })

  it("«Lo elijo yo» pide al menos un archivo y descarta ids raros y repetidos", () => {
    expect(validarPedido({ textos: "Puro salmón", fuentes: ["manual"] })).toMatch(/elegí al menos/)
    const p = validarPedido({
      textos: "Puro salmón",
      fuentes: ["manual"],
      elegidos: [{ origen: "archivo", id: ID }, { origen: "archivo", id: ID }, { origen: "drive", id: ID }, { origen: "instagram", id: "x" }],
    })
    expect(typeof p !== "string" && p.elegidos).toEqual([{ origen: "archivo", id: ID }])
  })

  it("sin «Lo elijo yo», lo elegido a mano no se guarda", () => {
    const p = validarPedido({ textos: "Puro salmón", fuentes: ["instagram"], elegidos: [{ origen: "archivo", id: ID }] })
    expect(typeof p !== "string" && p.elegidos).toEqual([])
  })
})

describe("textos sobre la pieza", () => {
  it("avisa del precio pero «40 piezas» no es precio", () => {
    expect(avisosTexto("Puro salmón 40 piezas")).toEqual([])
    expect(avisosTexto("40 piezas $31.900")[0]).toMatch(/precio/)
    expect(avisosTexto("Solo 12 mil")[0]).toMatch(/precio/)
  })

  it("lo que escribe la IA no puede tener precio, sellos ni ser largo", () => {
    expect(problemasTextoPieza("Todo salmón, 40 piezas")).toEqual([])
    expect(problemasTextoPieza("40 piezas a $31900")).toContain("tiene precio")
    expect(problemasTextoPieza("Gluten free")).toHaveLength(1)
    expect(problemasTextoPieza("x".repeat(80))).toContain("muy largo")
  })
})

describe("repartirMaterial", () => {
  it("cada versión arranca en otro archivo", () => {
    expect(repartirMaterial(5, 3)).toEqual([[0, 1, 2, 3], [1, 2, 3, 4], [2, 3, 4, 0]])
  })
  it("con poco material, lo rota", () => {
    expect(repartirMaterial(2, 3)).toEqual([[0, 1], [1, 0], [0, 1]])
    expect(repartirMaterial(0, 2)).toEqual([[], []])
  })
})

it("nombreDescarga", () => {
  expect(nombreDescarga("fasutofudo", 2, "9x16", "video")).toBe("fasutofudo-v2-9x16.mp4")
  expect(nombreDescarga("bijutsukan", 1, "4x5", "imagen")).toBe("bijutsukan-v1-4x5.jpg")
})

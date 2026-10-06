import { describe, expect, it } from "vitest"
import { conAlfa, leerPaleta } from "../../shared/cos/paleta"

describe("paleta de marca", () => {
  it("acepta los 4 colores en hex", () => {
    const p = { fondo: "#8fd3bf", titulo: "#14302a", acento: "#ff5c8a", acentoTexto: "#ffffff" }
    expect(leerPaleta(p)).toEqual(p)
  })
  it("si falta un color o no es hex, sigue con la del kit", () => {
    expect(leerPaleta(null)).toBeNull()
    expect(leerPaleta({ fondo: "#000000", titulo: "#fff", acento: "#ff5c8a", acentoTexto: "#ffffff" })).toBeNull()
    expect(leerPaleta({ fondo: "#000000", titulo: "#ffffff", acento: "rojo", acentoTexto: "#ffffff" })).toBeNull()
  })
  it("pasa a rgba con transparencia", () => {
    expect(conAlfa("#1b100c", 0.9)).toBe("rgba(27,16,12,0.9)")
  })
})

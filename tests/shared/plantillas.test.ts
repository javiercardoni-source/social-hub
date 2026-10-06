import { describe, expect, it } from "vitest"
import { PLANTILLAS, leerDiseno, normalizarCampos, plantilla, plantillasDe, textoDiseno } from "../../shared/cos/plantillas"

describe("plantillas propias por marca", () => {
  it("cada marca ve solo las suyas, del formato pedido y habilitadas", () => {
    const todas = PLANTILLAS.map((p) => p.id)
    expect(plantillasDe("bijutsukan", "feed", todas).map((p) => p.id)).toEqual(["bj_galeria", "bj_editorial", "bj_firma"])
    expect(plantillasDe("fasutofudo", "story", todas).map((p) => p.id)).toEqual(["ff_encuesta"])
    expect(plantillasDe("sensaciones", "feed", ["sn_cartel"]).map((p) => p.id)).toEqual(["sn_cartel"])
    expect(plantillasDe("sensaciones", "story", todas)).toEqual([])
  })

  it("nunca deja precios ni 'sin TACC' en la pieza", () => {
    const c = normalizarCampos(plantilla("sn_puro")!, { kicker: "Promo $12.500", titulo: "Puro Salmón", bajada: "40 piezas sin TACC a 9000 pesos" })
    expect(c.kicker).toBe("Promo")
    expect(c.bajada).not.toMatch(/\$|tacc|pesos|9000/i)
  })

  it("corta en palabra entera, saca emojis y deja una sola palabra donde va una", () => {
    const c = normalizarCampos(plantilla("bj_editorial")!, { kicker: "🍣 #Bijutsukan · primavera", titulo: "La carta de autor más linda de Buenos Aires", manuscrita: "nueva carta" })
    expect(c.kicker).toBe("Bijutsukan · primavera")
    expect(c.titulo!.length).toBeLessThanOrEqual(22)
    expect(c.titulo!.endsWith(" ")).toBe(false)
    expect(c.manuscrita).toBe("nueva")
  })

  it("descarta campos de otra plantilla y usa la frase del post si falta el título", () => {
    const c = normalizarCampos(plantilla("sn_cartel")!, { palabra: "CRUNCH" }, "Esta noche, sushi")
    expect(c).toEqual({ titulo: "Esta noche, sushi" })
  })

  it("un diseño de otra marca o desconocido no se usa", () => {
    expect(leerDiseno({ plantilla: "ff_palabra", campos: { palabra: "ñam" } }, "bijutsukan")).toBeNull()
    expect(leerDiseno({ plantilla: "nada", campos: {} }, "fasutofudo")).toBeNull()
    const d = leerDiseno({ plantilla: "ff_palabra", campos: { palabra: "ñam rico" }, numero: 3.7 }, "fasutofudo")
    expect(d).toEqual({ plantilla: "ff_palabra", campos: { palabra: "ñam" }, numero: 3 })
    expect(textoDiseno(d!)).toBe("ñam")
  })
})

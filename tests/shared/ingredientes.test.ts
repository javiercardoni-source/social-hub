import { describe, expect, it } from "vitest"
import {
  bloqueIngredientes,
  ingredientesEn,
  implicitosEn,
  ingredientesSinRespaldo,
  leerIngredientes,
  normalizarIngrediente,
  normalizarLista,
  respaldoDe,
  textosDePieza,
} from "../../shared/cos/ingredientes"

describe("ingredientesEn", () => {
  it("encuentra ingredientes con y sin tilde, en plural y en orden de aparición", () => {
    expect(ingredientesEn("Roll de salmon con palta y Langostinos crocantes")).toEqual(["salmón", "palta", "langostino"])
    expect(ingredientesEn("Sésamo tostado y sesamo negro")).toEqual(["sésamo"])
  })
  it("usa el vocabulario argentino como canónico", () => {
    expect(ingredientesEn("con avocado y camarones")).toEqual(["palta", "langostino"])
    expect(ingredientesEn("fresas y aguacate")).toEqual(["frutilla", "palta"])
  })
  it("'queso crema' no cuenta como 'queso' suelto", () => {
    expect(ingredientesEn("relleno de queso crema")).toEqual(["queso crema"])
    expect(ingredientesEn("queso cheddar y queso crema")).toEqual(["queso", "queso crema"])
  })
  it("no confunde palabras parecidas ni partes de otras", () => {
    expect(ingredientesEn("la palta es la paltita del barrio")).toEqual(["palta"])
    expect(ingredientesEn("dos mangos maduros")).toEqual(["mango"])
    expect(ingredientesEn("una banana split")).toEqual(["banana"])
    expect(ingredientesEn("#salmon #sushi")).toEqual(["salmón"])
  })
  it("texto sin ingredientes", () => {
    expect(ingredientesEn("Pedilo directo por WhatsApp")).toEqual([])
  })
})

describe("normalizarIngrediente / normalizarLista", () => {
  it("lleva a canónico lo que está en el vocabulario y deja limpio lo que no", () => {
    expect(normalizarIngrediente("Avocado")).toBe("palta")
    expect(normalizarIngrediente("langostinos")).toBe("langostino")
    expect(normalizarIngrediente("Salsa de soja")).toBe("salsa de soja")
    expect(normalizarIngrediente("  ")).toBe("")
  })
  it("sin repetidos, acotada, solo strings", () => {
    expect(normalizarLista(["salmón", "salmon", 3, "palta", "", "Palta"])).toEqual(["salmón", "palta"])
    expect(normalizarLista(Array.from({ length: 30 }, (_, i) => `x${i}`)).length).toBe(20)
    expect(normalizarLista("salmón")).toEqual([])
  })
})

describe("leerIngredientes", () => {
  it("null si el asset se clasificó antes de que existieran las listas", () => {
    expect(leerIngredientes({ summary: "roll" })).toBeNull()
    expect(leerIngredientes(null)).toBeNull()
  })
  it("lee y normaliza las dos listas", () => {
    expect(leerIngredientes({ ingredientes_visibles: ["Salmon", "arroz"], ingredientes_dudosos: ["queso crema o mayonesa"] })).toEqual({
      visibles: ["salmón", "arroz"],
      dudosos: ["queso crema o mayonesa"],
    })
    expect(leerIngredientes({ ingredientes_visibles: [] })).toEqual({ visibles: [], dudosos: [] })
  })
})

describe("respaldoDe + ingredientesSinRespaldo", () => {
  const vistos = { visibles: ["salmón", "arroz"], dudosos: ["palta"] }
  it("lo visible respalda; lo dudoso no", () => {
    const r = respaldoDe({ ingredientes: vistos, texto: "Roll de salmón con palta" })
    expect(ingredientesSinRespaldo(["Roll de salmón con palta"], r)).toEqual(["palta"])
  })
  it("lo que dijo una persona respalda", () => {
    const r = respaldoDe({ ingredientes: vistos, dichoPorPersona: "roll de langostino y palta", texto: "" })
    expect(ingredientesSinRespaldo(["Langostinos con palta y salmón"], r)).toEqual([])
  })
  it("una descripción escrita por la IA no se pasa como dicha por una persona (lo decide quien llama)", () => {
    const r = respaldoDe({ ingredientes: vistos, dichoPorPersona: null, texto: "" })
    expect(ingredientesSinRespaldo(["Roll con mango"], r)).toEqual(["mango"])
  })
  it("el nombre de un combo respalda sus ingredientes solo si el texto nombra el combo completo", () => {
    const combos = ["Combo Salmón Lover", "Bandeja Langostino Crispy"]
    const con = respaldoDe({ ingredientes: { visibles: [], dudosos: [] }, combos, texto: "Pedí el Combo Salmón Lover hoy" })
    expect(ingredientesSinRespaldo(["Pedí el Combo Salmón Lover hoy"], con)).toEqual([])
    const sin = respaldoDe({ ingredientes: { visibles: [], dudosos: [] }, combos, texto: "Salmón fresco para vos" })
    expect(ingredientesSinRespaldo(["Salmón fresco para vos"], sin)).toEqual(["salmón"])
  })
  it("sin lista verificada, cualquier ingrediente queda sin respaldo", () => {
    const r = respaldoDe({ ingredientes: null, texto: "" })
    expect(ingredientesSinRespaldo(["Onigiri de atún", "#salmon"], r)).toEqual(["atún", "salmón"])
  })
  it("revisa todos los textos juntos (caption, frase, hashtags, palabras del reel)", () => {
    const r = respaldoDe({ ingredientes: vistos, texto: "" })
    expect(ingredientesSinRespaldo(["Sabor de siempre", "PALTA", "#arroz"], r)).toEqual(["palta"])
  })
})

describe("bloqueIngredientes", () => {
  it("sin lista: prohíbe nombrar ingredientes puntuales", () => {
    expect(bloqueIngredientes(null)).toMatch(/NO nombres ningún ingrediente/)
  })
  it("con lista: los visibles son los únicos y los dudosos quedan prohibidos", () => {
    const b = bloqueIngredientes({ visibles: ["salmón", "palta"], dudosos: ["queso crema"] })
    expect(b).toContain("salmón, palta")
    expect(b).toMatch(/Dudosos.*queso crema/)
  })
  it("lista vacía: lo dice y no inventa", () => {
    expect(bloqueIngredientes({ visibles: [], dudosos: [] })).toContain("(ninguno con certeza)")
  })
})

describe("textosDePieza", () => {
  it("junta texto, hashtags, frase y los textos del guion del reel", () => {
    const t = textosDePieza(
      { caption: "Hola", hashtags: "#salmon", overlay_text: "PEDILO", montaje: { gancho: "ASÍ", medio: "", titulo_cierre: "YA", idea: "roll", palabras: ["UN", "ROLL", 3] } },
      "sensaciones",
    )
    expect(t).toEqual(["Hola", "#salmon", "PEDILO", "ASÍ", "YA", "roll", "UN", "ROLL"])
  })
  it("ignora lo que no es texto o no es una plantilla válida", () => {
    expect(textosDePieza({ caption: null, montaje: "x", diseno: { plantilla: "no_existe", campos: { titulo: "Palta" } } }, "bijutsukan")).toEqual([])
  })
})

describe("implícitos del plato", () => {
  it("hablar de un onigiri o un roll habilita arroz y alga; un nigiri solo arroz", () => {
    expect(implicitosEn(["Mirá cómo sellamos cada onigiri"])).toEqual(["arroz", "nori"])
    expect(implicitosEn(["Nigiris de salmón"])).toEqual(["arroz"])
    expect(implicitosEn(["Pedilo por WhatsApp"])).toEqual([])
  })
  it("en el control: el arroz de un onigiri no es un invento, el relleno sí", () => {
    const r = respaldoDe({ ingredientes: { visibles: ["onigiri", "alga nori"], dudosos: ["atún"] }, texto: "Onigiri de atún con arroz" })
    expect(ingredientesSinRespaldo(["Onigiri de atún con arroz"], r)).toEqual(["atún"])
  })
  it("queso crema visible respalda 'queso' a secas", () => {
    const r = respaldoDe({ ingredientes: { visibles: ["queso crema"], dudosos: [] }, texto: "queso cremoso en cada corte" })
    expect(ingredientesSinRespaldo(["queso cremoso en cada corte"], r)).toEqual([])
  })
  it("remolacha ya está en el vocabulario (la palabra por corte decía REMOLACHA sin verse)", () => {
    expect(ingredientesEn("ROLL DE PALTA Y REMOLACHA")).toEqual(["palta", "remolacha"])
  })
})

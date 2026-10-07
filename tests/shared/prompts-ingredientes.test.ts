import { describe, expect, it } from "vitest"
import { captionPrompt, classifierPrompt, ingredientesPrompt, reelPrompt } from "../../shared/cos/prompts"

const ing = { visibles: ["salmón", "arroz"], dudosos: ["queso crema"] }

describe("classifierPrompt", () => {
  it("pide las dos listas de ingredientes y un resumen sin adivinar", () => {
    const p = classifierPrompt({ description: "roll", submittedBy: null, mediaType: "photo", frames: 1 })
    expect(p).toContain("ingredientes_visibles")
    expect(p).toContain("ingredientes_dudosos")
    expect(p).toMatch(/summary: .*SIN adivinar ingredientes/)
  })
  it("una descripción provisoria no vale como dato", () => {
    const p = classifierPrompt({ description: "IMG_2231", submittedBy: null, mediaType: "photo", frames: 1, archivo: true, descripcionProvisoria: true })
    expect(p).toContain("PROVISORIA")
    expect(p).not.toContain('Descripción del empleado: "IMG_2231"')
  })
})

describe("captionPrompt", () => {
  const base = { platform: "instagram" as const, postType: "feed" as const, descriptions: ["roll de salmón"], aiSummaries: ["roll"] }
  it("con lista: los visibles son los únicos y los dudosos quedan prohibidos", () => {
    const p = captionPrompt({ ...base, ingredientes: ing })
    expect(p).toContain("salmón, arroz")
    expect(p).toMatch(/Dudosos.*queso crema/)
    expect(p).toContain("Empleado: \"roll de salmón\"")
  })
  it("sin lista: no se nombra ningún ingrediente", () => {
    expect(captionPrompt(base)).toMatch(/NO nombres ningún ingrediente/)
  })
  it("una descripción escrita por la IA no se presenta como del empleado", () => {
    const p = captionPrompt({ ...base, descripcionPorIA: true })
    expect(p).toContain("la escribió la IA")
    expect(p).not.toContain("Empleado:")
  })
  it("la idea del reel va aparte, como del motor", () => {
    const p = captionPrompt({ ...base, ideaReel: "tres rolls en fila" })
    expect(p).toMatch(/Idea del reel \(la escribió el motor.*"tres rolls en fila"/)
  })
})

describe("reelPrompt", () => {
  it("lleva la lista y la aplica a todos los textos del reel", () => {
    const p = reelPrompt({ marca: "Sensaciones", recuadros: ["DELIVERY"], temas: [], combos: [], ingredientes: ing })
    expect(p).toContain("salmón, arroz")
    expect(p).toMatch(/gancho, medio, titulo_cierre, palabras e idea/)
  })
})

describe("ingredientesPrompt", () => {
  it("foto o video, con lo que dijo una persona o con descripción provisoria", () => {
    expect(ingredientesPrompt({ frames: 1, dicho: "roll de palta" })).toMatch(/FOTO.*\n.*El empleado dijo: "roll de palta"/)
    expect(ingredientesPrompt({ frames: 4, dicho: "carpeta 3", provisoria: true })).toMatch(/4 fotogramas.*\n.*PROVISORIA/)
    expect(ingredientesPrompt({ frames: 1 })).toContain("ingredientes_dudosos")
  })
})

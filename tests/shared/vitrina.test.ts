import { describe, expect, it } from "vitest"
import { aRetirar, chipOferta, mensajeWhatsApp, nombreAnuncio, slugVitrina, textoCompartir, textoProhibido, vigente } from "../../shared/cos/vitrina"

describe("vitrina", () => {
  it("slug legible + 6 letras al azar", () => {
    const s = slugVitrina("Onigiris de octubre · FasutoFudo")
    expect(s).toMatch(/^onigiris-octubre-fasutofudo-[a-z2-9]{6}$/)
    expect(slugVitrina("")).toMatch(/^vitrina-[a-z2-9]{6}$/)
  })
  it("mensaje pre-escrito del welcome message de Meta", () => {
    const w = JSON.stringify({ text_format: { message: { autofill_message: { content: "¡Hola! Quiero el Combo 5 Onigiris de $15.000 🍙" } } } })
    expect(mensajeWhatsApp(w)).toBe("¡Hola! Quiero el Combo 5 Onigiris de $15.000 🍙")
    expect(mensajeWhatsApp("no es json")).toBeNull()
  })
  it("chip y nombre", () => {
    expect(chipOferta("Combo 5 Onigiris · $15.000")).toBe("$15.000")
    expect(chipOferta("40 piezas todo salmón")).toBeNull()
    expect(nombreAnuncio("AD_FF_C_con-la-mano", 0)).toBe("C · Con la mano")
    expect(nombreAnuncio("MOTOR · 40 piezas todo salmón · 9x16", 1)).toBe("40 piezas todo salmón")
    expect(nombreAnuncio("Promoción del sitio web https://x", 2)).toBe("Anuncio 3")
  })
  it("rotación: quedan N vivas, la nueva nunca se retira", () => {
    const vs = Array.from({ length: 8 }, (_, i) => ({ id: `v${i}`, estado: (i === 2 ? "retirada" : "aprobada") as "aprobada", created_at: `2026-10-0${i + 1}` }))
    // v7 es la nueva; vivas: v0 v1 v3 v4 v5 v6 v7 → con max 6 se retira v0
    expect(aRetirar(vs, 6, "v7")).toEqual(["v0"])
    expect(aRetirar(vs, 3, "v7")).toEqual(["v4", "v3", "v1", "v0"])
  })
  it("el link fijo muestra la última aprobada (o la última lista)", () => {
    expect(vigente([{ id: "a", estado: "aprobada", created_at: "1", approved_at: "2026-10-01" }, { id: "b", estado: "lista", created_at: "2026-10-05" }])?.id).toBe("a")
    expect(vigente([{ id: "b", estado: "lista", created_at: "2026-10-05" }, { id: "c", estado: "retirada", created_at: "2026-10-06" }])?.id).toBe("b")
    expect(vigente([])).toBeNull()
  })
  it("texto para compartir sin precio y con la mención", () => {
    expect(textoCompartir({ usuario: "fasutofudo", titulo: "Combo 5 Onigiris · $15.000" })).toBe("Combo 5 Onigiris @fasutofudo")
    expect(textoProhibido("Apto celíacos")).toBe(true)
  })
})

import { describe, expect, it } from "vitest"
import { MOTIVOS, leccionesDeRechazos, validarRechazo } from "../../shared/cos/rechazos"

describe("rechazos con motivo", () => {
  it("pide al menos un motivo o una explicación", () => {
    expect(validarRechazo([], "")).toMatch(/Elegí un motivo/)
    expect(validarRechazo(["texto"], "")).toBeNull()
    expect(validarRechazo([], "muy formal")).toBeNull()
    expect(validarRechazo(["cualquiera"], "")).toBe("Motivo inválido")
  })
  it("arma las lecciones: lo más rechazado y las explicaciones sin repetir", () => {
    const r = leccionesDeRechazos([
      { reasons: ["texto", "voz"], note: "Muy formal, hablale como a un amigo", post_type: "feed", caption: "Estimado cliente, le ofrecemos", overlay_text: null, at: "2026-10-05" },
      { reasons: ["texto"], note: "muy formal, hablale como a un amigo", post_type: "reel", caption: "x", overlay_text: null, at: "2026-10-04" },
      { reasons: ["foto"], note: null, post_type: "feed", caption: null, overlay_text: null, at: "2026-10-03" },
    ])
    expect(r).toContain("textos que no le gustaron (2)")
    expect(r).toContain("«Muy formal, hablale como a un amigo» (sobre: \"Estimado cliente, le ofrecemos\")")
    expect(r.match(/hablale/gi)?.length).toBe(1)
    expect(leccionesDeRechazos([])).toBe("")
  })
})

describe("motivo «Ingredientes incorrectos» (Javier, 07-10-2026)", () => {
  it("existe, vale como motivo y llega a la IA como lección", () => {
    expect(MOTIVOS.some((m) => m.id === "ingredientes" && m.label === "Ingredientes incorrectos")).toBe(true)
    expect(validarRechazo(["ingredientes"], "")).toBeNull()
    const l = leccionesDeRechazos([{ reasons: ["ingredientes"], note: null, post_type: "reel", caption: "Roll de atún", overlay_text: null, at: "2026-10-07T10:00:00Z" }])
    expect(l).toContain("ingredientes nombrados que no estaban en la imagen (1)")
  })
})

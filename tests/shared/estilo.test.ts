import { describe, expect, it } from "vitest"
import { paraPorDefecto, resumenEstilo } from "../../shared/cos/estilo"

describe("referencias por formato", () => {
  it("el formato por defecto sale del archivo", () => {
    expect(paraPorDefecto("video/mp4")).toBe("reel")
    expect(paraPorDefecto("image/jpeg", 1080, 1920)).toBe("historia")
    expect(paraPorDefecto("image/jpeg", 1080, 1350)).toBe("post")
    expect(paraPorDefecto("image/png")).toBe("post")
  })
  it("sin fichas no hay bloque de estilo", () => {
    expect(resumenEstilo([], "reel")).toBe("")
  })
  it("reels: ritmo medido, planos y movimientos; no habla de tipografía", () => {
    const r = resumenEstilo(
      [
        { resumen: "cortes al pulso", planos: ["detalle", "cenital"], movimientos: ["acercamiento rápido"], tipografia: "Anton", medidas: { duracion_s: 10, cortes: 9, toma_promedio_s: 1 } },
        { planos: ["detalle", "manos"], medidas: { duracion_s: 12, cortes: 5, toma_promedio_s: 2 } },
      ],
      "reel",
    )
    expect(r).toContain("una toma cada 1.5 s")
    expect(r).toContain("Planos: detalle, cenital, manos")
    expect(r).toContain("acercamiento rápido")
    expect(r).not.toContain("Anton")
    expect(r).toContain("Nunca copies precios")
  })
  it("posts: tipografía y composición, sin ritmo", () => {
    const r = resumenEstilo([{ tipografia: "sans condensada gruesa", ritmo: "estática", estructura: ["producto al centro"], evitar: ["logo ajeno"] }], "post")
    expect(r).toContain("Tipografía y jerarquía: sans condensada gruesa")
    expect(r).toContain("Composición: producto al centro")
    expect(r).toContain("Evitar: logo ajeno")
    expect(r).not.toContain("Ritmo")
  })
})

import { describe, expect, it } from "vitest"
import { describirEstilo, evaluarEstilo, llevaTexto, normalizarEstilo, ordenarGrilla, type Pieza } from "../../shared/cos/grilla"

const p = (id: string, estado: Pieza["estado"], at: string | null, conTexto: boolean | null = null): Pieza => ({ id, estado, at, formato: "feed", conTexto })

describe("ordenarGrilla", () => {
  it("pendientes, después programados (el más lejano primero) y lo publicado del más nuevo al más viejo", () => {
    const g = ordenarGrilla([
      p("pub-viejo", "publicado", "2026-09-01T10:00:00Z"),
      p("prog-pronto", "programado", "2026-10-01T10:00:00Z"),
      p("pub-nuevo", "publicado", "2026-09-20T10:00:00Z"),
      p("pend", "pendiente", null),
      p("prog-lejos", "programado", "2026-10-05T10:00:00Z"),
    ])
    expect(g.map((x) => x.id)).toEqual(["pend", "prog-lejos", "prog-pronto", "pub-nuevo", "pub-viejo"])
  })
})

describe("evaluarEstilo", () => {
  const estilo = normalizarEstilo({ columnas: ["con_texto", "sin_texto", "con_texto"] })
  it("marca cada pieza según la regla de su columna", () => {
    const g = [p("a", "programado", "x", true), p("b", "programado", "x", true), p("c", "programado", "x", true), p("d", "publicado", "x", null)]
    expect(evaluarEstilo(g, estilo)).toEqual(["ok", "rompe", "ok", "desconocido"])
  })
  it("columna libre no se evalúa", () => {
    expect(evaluarEstilo([p("a", "programado", "x", false)], normalizarEstilo(null))).toEqual(["sin_regla"])
  })
})

describe("llevaTexto / normalizarEstilo / describirEstilo", () => {
  it("firma o sin plantilla no cuentan como texto", () => {
    expect(llevaTexto("banda", "Plan en casa")).toBe(true)
    expect(llevaTexto("etiqueta", "  ")).toBe(false)
    expect(llevaTexto("firma", "Plan en casa")).toBe(false)
    expect(llevaTexto("none", "x")).toBe(false)
  })
  it("normaliza basura a libre y describe", () => {
    expect(normalizarEstilo({ columnas: ["con_texto", "otra cosa", "sin_texto"] }).columnas).toEqual(["con_texto", "libre", "sin_texto"])
    expect(describirEstilo(normalizarEstilo({ columnas: ["con_texto", "sin_texto", "con_texto"] }))).toBe("Izquierda con texto · Centro sin texto · Derecha con texto")
  })
})

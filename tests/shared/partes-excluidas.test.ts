import { describe, expect, it } from "vitest"
import { normalizarExcluidos, normalizarGuion, ventanaLibre } from "../../shared/cos/reel"

describe("partes del video que no se usan", () => {
  it("limpia lo marcado: dentro del video, ordenado y unido", () => {
    expect(normalizarExcluidos([[8, 6], [5, 6.5], [-1, 0.5], [12, 30], [3, 3.05], "x"], 15)).toEqual([[0, 0.5], [5, 8], [12, 15]])
    expect(normalizarExcluidos(null)).toEqual([])
  })

  it("corre la toma al hueco libre más cercano o la descarta", () => {
    expect(ventanaLibre(4, 1, 15, [[3, 6]])).toBe(6)
    expect(ventanaLibre(3.5, 1, 15, [[3, 6]])).toBe(2)
    expect(ventanaLibre(9, 1, 15, [[3, 6]])).toBe(9)
    expect(ventanaLibre(1, 2, 4, [[0, 1.5], [2.5, 4]])).toBeNull()
  })

  it("ninguna toma del guion cae en una parte excluida", () => {
    const g = normalizarGuion(
      { tomas: [{ fuente: 0, trim_start: 2, duracion: 2 }, { fuente: 0, trim_start: 7, duracion: 2 }, { fuente: 0, trim_start: 11, duracion: 2 }] },
      [{ tipo: "video", duracion: 14, excluir: [[1.5, 9]] }],
    )
    expect(g.tomas.length).toBe(3)
    for (const t of g.tomas) expect(t.trim_start >= 9 || t.trim_start + t.duracion <= 1.5).toBe(true)
  })
})

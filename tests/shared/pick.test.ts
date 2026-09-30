import { describe, expect, it } from "vitest"
import { elegir, incertidumbrePorN, ordenar, porqueMusica, rng, TOPE_EXPLORACION, type Candidato } from "../../shared/cos/pick"

const c = (id: string, efecto: number, n = 20, usos = 0): Candidato => ({ id, titulo: id, efecto, incertidumbre: incertidumbrePorN(n), usosRecientes: usos, n })
const temas = [c("jazz", 1.3), c("house", 1.0), c("lounge", 0.9), c("nuevo", 1.0, 0)]

describe("elegir", () => {
  it("nunca elige fuera de los candidatos (ni lo excluido)", () => {
    for (let i = 0; i < 200; i++) {
      const e = elegir(temas, { semilla: `p${i}`, excluir: ["jazz"] })!
      expect(["house", "lounge", "nuevo"]).toContain(e.elegido)
    }
    expect(elegir([], { semilla: "x" })).toBeNull()
    expect(elegir([c("a", 1)], { semilla: "x", excluir: ["a"] })).toBeNull()
  })

  it("mismo post = misma elección (un reintento no cambia la música)", () => {
    expect(elegir(temas, { semilla: "post-123" })).toEqual(elegir(temas, { semilla: "post-123" }))
  })

  it("la exploración no pasa del tope: en muchos sorteos, ~70 % o más aprovecha", () => {
    let probar = 0
    const N = 2000
    for (let i = 0; i < N; i++) if (elegir(temas, { semilla: `s${i}` })!.modo === "probar") probar++
    expect(probar / N).toBeLessThanOrEqual(TOPE_EXPLORACION + 0.02)
    expect(probar / N).toBeGreaterThan(0.05)
  })

  it("en campañas (exploración 0) siempre aprovecha: elige lo mejor", () => {
    for (let i = 0; i < 100; i++) {
      const e = elegir(temas, { semilla: `f${i}`, exploracion: 0 })!
      expect(e.modo).toBe("aprovechar")
      expect(e.elegido).toBe("jazz")
    }
  })

  it("el desgaste baja a lo repetido", () => {
    const gastado = [c("jazz", 1.2, 20, 6), c("house", 1.0)]
    expect(elegir(gastado, { semilla: "z", exploracion: 0 })!.elegido).toBe("house")
    expect(ordenar(gastado)[0].id).toBe("house")
  })

  it("lo que tiene poca historia tiene más chances al probar que lo conocido y malo", () => {
    let nuevo = 0
    let malo = 0
    for (let i = 0; i < 3000; i++) {
      const e = elegir([c("bueno", 1.2, 60), c("malo", 0.8, 60), c("nuevo", 1.0, 0)], { semilla: `q${i}` })!
      if (e.elegido === "nuevo") nuevo++
      if (e.elegido === "malo") malo++
    }
    expect(nuevo).toBeGreaterThan(malo)
  })

  it("pick_json completo: candidatos, modo, semilla, tope y modelo", () => {
    const e = elegir(temas, { semilla: "p1", modelo: "2026-10-01" })!
    expect(e.candidatos.length).toBe(4)
    expect(e).toMatchObject({ semilla: "p1", exploracion: TOPE_EXPLORACION, modelo: "2026-10-01" })
  })
})

describe("textos", () => {
  it("porqué de la música", () => {
    expect(porqueMusica({ modo: "aprovechar", titulo: "Piano jazz", esperado: 1.18 }, 20)).toBe("🎵 Piano jazz · elegida por el motor (+18 %, confianza alta)")
    expect(porqueMusica({ modo: "probar", titulo: "Tema nuevo", esperado: 1 }, 0)).toBe("🧪 Probando: Tema nuevo")
    expect(porqueMusica({ modo: "aprovechar", titulo: "X", esperado: 1 }, 0)).toMatch(/poca data/)
  })
  it("rng determinístico y en [0,1)", () => {
    const a = rng("x")
    const b = rng("x")
    for (let i = 0; i < 50; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

import { describe, expect, it } from "vitest"
import { elegirSetDeMusica, esMusicaRetirada } from "../../shared/cos/musica-actualizar"

const p = (id: string, origen: string, brandSlug: string, retirada: boolean, createdAt: string) => ({
  id,
  origen,
  brandSlug,
  musicKey: retirada ? `music-retirada/${brandSlug}/x.mp3` : `music/${brandSlug}/y.mp3`,
  createdAt,
})

describe("esMusicaRetirada", () => {
  it("solo las que se movieron a music-retirada/", () => {
    expect(esMusicaRetirada("music-retirada/fasutofudo/x.mp3")).toBe(true)
    expect(esMusicaRetirada("music/fasutofudo/x.mp3")).toBe(false)
    expect(esMusicaRetirada(null)).toBe(false)
  })
})

describe("elegirSetDeMusica", () => {
  it("agrupa por subida, ignora lo que ya tiene música nueva y lo que no es reel", () => {
    const piezas = [
      p("a1", "asset:1", "fasutofudo", true, "2026-10-01"),
      p("a2", "asset:1", "fasutofudo", true, "2026-10-01"), // misma subida (reel + historia)
      p("b1", "asset:2", "fasutofudo", false, "2026-10-02"), // ya tiene música nueva
      p("c1", "asset:3", "sensaciones", true, "2026-10-03"),
    ]
    const sets = elegirSetDeMusica(piezas, 3)
    expect(sets.fasutofudo).toEqual([{ origen: "asset:1", postIds: ["a1", "a2"] }])
    expect(sets.sensaciones).toEqual([{ origen: "asset:3", postIds: ["c1"] }])
  })

  it("por marca, elige como mucho `setSize` subidas, las más viejas primero", () => {
    const piezas = Array.from({ length: 10 }, (_, i) => p(`p${i}`, `asset:${i}`, "fasutofudo", true, `2026-10-${String(i + 1).padStart(2, "0")}`))
    const sets = elegirSetDeMusica(piezas, 3)
    expect(sets.fasutofudo).toHaveLength(3)
    expect(sets.fasutofudo.map((s) => s.origen)).toEqual(["asset:0", "asset:1", "asset:2"])
  })

  it("una marca sin nada retirado no aparece (no un array vacío)", () => {
    const piezas = [p("a1", "asset:1", "bijutsukan", false, "2026-10-01")]
    const sets = elegirSetDeMusica(piezas, 3)
    expect(sets.bijutsukan).toBeUndefined()
    expect(sets).toEqual({})
  })

  it("piezas sin origen o sin marca se ignoran (defensivo)", () => {
    const piezas = [{ id: "x", origen: "", brandSlug: "fasutofudo", musicKey: "music-retirada/fasutofudo/x.mp3", createdAt: "2026-10-01" }]
    expect(elegirSetDeMusica(piezas, 3)).toEqual({})
  })
})

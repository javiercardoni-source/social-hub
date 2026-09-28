import { describe, expect, it } from "vitest"
import { isDue } from "../../shared/cos/metrics-due"

const H = 3600_000
const now = Date.parse("2026-09-28T20:00:00Z")
const ago = (ms: number) => new Date(now - ms).toISOString()

describe("isDue (cuándo se vuelve a medir una publicación)", () => {
  it("lo nunca medido se mide", () => expect(isDue(ago(400 * 24 * H), null, now)).toBe(true))
  it("lo nuevo (<3 días) cada 2 horas", () => {
    expect(isDue(ago(10 * H), ago(1 * H), now)).toBe(false)
    expect(isDue(ago(10 * H), ago(2 * H), now)).toBe(true)
  })
  it("<30 días una vez por día; <90 días una vez por semana; más viejo nunca más", () => {
    expect(isDue(ago(10 * 24 * H), ago(12 * H), now)).toBe(false)
    expect(isDue(ago(10 * 24 * H), ago(25 * H), now)).toBe(true)
    expect(isDue(ago(60 * 24 * H), ago(3 * 24 * H), now)).toBe(false)
    expect(isDue(ago(60 * 24 * H), ago(8 * 24 * H), now)).toBe(true)
    expect(isDue(ago(200 * 24 * H), ago(100 * 24 * H), now)).toBe(false)
  })
  it("una historia vencida ya medida no se vuelve a consultar", () => {
    expect(isDue(ago(30 * H), ago(3 * H), now, "story")).toBe(false)
    expect(isDue(ago(20 * H), ago(3 * H), now, "story")).toBe(true)
  })
})

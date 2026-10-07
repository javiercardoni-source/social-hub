import { describe, expect, it } from "vitest"
import { proximaMañana } from "../../worker/src/push"

describe("aviso push de aprobación: nunca de noche", () => {
  it("de madrugada se guarda para las 8:30 de ese día", () => {
    // 02:00 de Buenos Aires = 05:00 UTC
    expect(proximaMañana(new Date("2026-10-08T05:00:00Z")).toISOString()).toBe("2026-10-08T11:30:00.000Z")
  })
  it("a las 23:30 se guarda para las 8:30 del día siguiente", () => {
    expect(proximaMañana(new Date("2026-10-09T02:30:00Z")).toISOString()).toBe("2026-10-09T11:30:00.000Z")
  })
})

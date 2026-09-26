import { describe, it, expect } from "vitest"
import { decideScheduledPost } from "../../shared/cos/missed-policy"

const at = new Date("2026-09-29T22:30:00Z") // martes 19:30 en Buenos Aires
const plus = (min: number) => new Date(at.getTime() + min * 60_000)

describe("MISSED_POST_POLICY", () => {
  it("antes de la hora, espera", () => {
    expect(decideScheduledPost(at, plus(-1), "publish_within_tolerance", 30)).toBe("wait")
  })
  it("a la hora o con segundos de demora, publica", () => {
    expect(decideScheduledPost(at, at, "publish_within_tolerance", 30)).toBe("publish")
    expect(decideScheduledPost(at, plus(0.5), "never_publish_late", 30)).toBe("publish")
  })
  it("hasta 30 minutos tarde, publica igual", () => {
    expect(decideScheduledPost(at, plus(30), "publish_within_tolerance", 30)).toBe("publish")
  })
  it("más de 30 minutos tarde, queda perdido", () => {
    expect(decideScheduledPost(at, plus(31), "publish_within_tolerance", 30)).toBe("missed")
  })
  it("con la política estricta, cualquier atraso real queda perdido", () => {
    expect(decideScheduledPost(at, plus(5), "never_publish_late", 30)).toBe("missed")
  })
})

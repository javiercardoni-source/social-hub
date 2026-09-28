import { describe, expect, it } from "vitest"
import { isDeliveryDay, nthWeekday, specialDaysFor, weatherText } from "../../shared/cos/special-days"

describe("fechas especiales", () => {
  it("calcula las fechas móviles de 2026", () => {
    const f = Object.fromEntries(specialDaysFor(2026).map((d) => [d.name, d.day]))
    expect(f["Día de la Madre"]).toBe("2026-10-18") // 3.er domingo de octubre
    expect(f["Día del Padre"]).toBe("2026-06-21")
    expect(f["Día del Niño"]).toBe("2026-08-16")
    expect(f["Black Friday"]).toBe("2026-11-27")
    expect(f["Día del Amigo"]).toBe("2026-07-20")
  })
  it("nthWeekday", () => {
    expect(nthWeekday(2026, 9, 1, 1)).toBe("2026-09-07") // primer lunes de septiembre
  })
  it("todas las fechas son del año pedido y tienen idea de contenido", () => {
    for (const d of specialDaysFor(2027)) {
      expect(d.day.startsWith("2027-")).toBe(true)
      expect(d.hint.length).toBeGreaterThan(10)
    }
  })
})

describe("clima", () => {
  it("traduce los códigos", () => {
    expect(weatherText(0)).toBe("despejado")
    expect(weatherText(95)).toBe("tormenta")
    expect(weatherText(63)).toBe("lluvia")
  })
  it("día de delivery: lluvia probable, frío o calor fuerte", () => {
    expect(isDeliveryDay({ code: 95, tmax: 20, tmin: 14, rain_prob: 99 })).toBe(true)
    expect(isDeliveryDay({ code: 3, tmax: 9, tmin: 3, rain_prob: 5 })).toBe(true)
    expect(isDeliveryDay({ code: 0, tmax: 35, tmin: 24, rain_prob: 0 })).toBe(true)
    expect(isDeliveryDay({ code: 1, tmax: 22, tmin: 12, rain_prob: 10 })).toBe(false)
  })
})

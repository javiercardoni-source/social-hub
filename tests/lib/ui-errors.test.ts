import { describe, expect, it } from "vitest"
import { aviso } from "../../src/lib/aviso"
import { explicarError } from "../../src/lib/ui-errors"

// Así llega un error de una acción del servidor al navegador en producción: sin el texto.
const enmascarado = (digest: string) =>
  Object.assign(new Error("An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details."), { digest })

describe("explicarError", () => {
  it("recupera el texto de un aviso aunque producción lo esconda", () => {
    const original = aviso("Este módulo ya está cerrado. Reabrilo para seguir.") as Error & { digest: string }
    expect(explicarError(enmascarado(original.digest))).toBe("Este módulo ya está cerrado. Reabrilo para seguir.")
  })

  it("en desarrollo (sin enmascarar) muestra el mismo texto", () => {
    expect(explicarError(aviso("No hay cuenta conectada"))).toBe("No hay cuenta conectada")
  })

  it("un error imprevisto del servidor se explica en castellano, con el código", () => {
    const msg = explicarError(enmascarado("395762628"))
    expect(msg).toMatch(/Algo falló del lado del servidor \(código 395762628\)/)
    expect(msg).not.toMatch(/Server Components/)
  })

  it("una versión nueva deployada pide recargar", () => {
    expect(explicarError(new Error('Failed to find Server Action "abc"'))).toMatch(/Recargá la página/)
  })

  it("un digest mal formado no rompe", () => {
    expect(explicarError(enmascarado("AVISO:%E0%A4%A"))).toMatch(/Algo falló/)
  })
})

import { describe, expect, it } from "vitest"
import { claveVapid } from "../../src/lib/push-vapid"

describe("conversión de la clave VAPID para PushManager.subscribe", () => {
  it("decodifica una clave real (65 bytes, arranca con 0x04: punto EC sin comprimir)", () => {
    // Clave de prueba, no la de producción (formato idéntico: 87 caracteres base64url, sin '=').
    const b64 = "BMxY9D62-Fouo28LjnRFcfS_wE6rM0mVtHjdwqXZ7hkzpQY5c0qHfvLhYQsqnDkN7ZC9m6KX9u3oP1rN4sYhLq0"
    const out = claveVapid(b64)
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out.length).toBe(65)
    expect(out[0]).toBe(4)
  })

  it("convierte - y _ (base64url) a + y / (base64 normal) antes de decodificar", () => {
    // "+" y "/" codificados como "-" y "_": si no se revierte, atob tira o da bytes distintos.
    const base64 = "Pj9-"
    const url = "Pj9-".replace(/\+/g, "-").replace(/\//g, "_")
    expect(claveVapid(url)).toEqual(claveVapid(base64.replace(/-/g, "+").replace(/_/g, "/")))
  })

  it("le agrega el relleno ('=') que le falta según el largo", () => {
    // Base64 válido sin relleno: el resto de dividir por 4 es 0, 2 o 3 (nunca 1).
    for (const s of ["QQED", "QQE", "QQ"]) expect(() => claveVapid(s)).not.toThrow()
  })
})

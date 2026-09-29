import { describe, expect, it } from "vitest"
import { MAX_SUBIDA, validarArchivo } from "../../shared/cos/motores"

const bytes = (s: string | number[]) => (typeof s === "string" ? new TextEncoder().encode(s.padEnd(8, " ")) : new Uint8Array(s))

describe("validarArchivo", () => {
  it("acepta cada tipo con su formato", () => {
    expect(validarArchivo("referencia", "reel.MP4", 1000)).toBeNull()
    expect(validarArchivo("musica", "tema.mp3", 1000)).toBeNull()
    expect(validarArchivo("logo", "logo.png", 1000, bytes([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBeNull()
    expect(validarArchivo("fuente_titulo", "Anton.ttf", 1000, bytes([0, 1, 0, 0, 0, 0]))).toBeNull()
    expect(validarArchivo("fuente_texto", "x.otf", 1000, bytes("OTTO"))).toBeNull()
    expect(validarArchivo("fuente_texto", "x.woff", 1000, bytes("wOFF"))).toBeNull()
  })

  it("WOFF2 se explica aparte (las plantillas no lo leen)", () => {
    expect(validarArchivo("fuente_titulo", "x.woff2", 1000)).toMatch(/WOFF2 no sirve/)
  })

  it("rechaza formatos de otro tipo y archivos que mienten", () => {
    expect(validarArchivo("logo", "logo.jpg", 1000)).toMatch(/Formato no aceptado/)
    expect(validarArchivo("logo", "logo.png", 1000, bytes("GIF89a"))).toMatch(/no es un PNG/)
    expect(validarArchivo("fuente_titulo", "x.ttf", 1000, bytes("<html>"))).toMatch(/no parece una tipografía/)
  })

  it("respeta el tope de 48 MB y avisa cómo resolverlo", () => {
    expect(validarArchivo("referencia", "r.mp4", MAX_SUBIDA + 1)).toMatch(/Recortá el video/)
    expect(validarArchivo("musica", "t.mp3", 0)).toMatch(/vacío/)
  })
})

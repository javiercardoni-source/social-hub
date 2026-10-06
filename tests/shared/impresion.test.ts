import { describe, expect, it } from "vitest"
import { avisoFoto, conDpi, linkWhatsapp, medidas, nombreArchivo, numeroLocal, validarFormato } from "../../shared/cos/impresion"

describe("diseño gráfico para imprenta", () => {
  it("un imán de 7 × 9 cm a 300 dpi con 3 mm de sangrado", () => {
    expect(medidas({ ancho_mm: 70, alto_mm: 90, sangrado_mm: 3, dpi: 300 })).toEqual({ ancho: 827, alto: 1063, sangrado: 35, totalAncho: 897, totalAlto: 1133 })
  })

  it("las medidas se cargan en cm y se validan", () => {
    expect(validarFormato({ nombre: " Imán ", ancho_cm: 7, alto_cm: 9 })).toEqual({ nombre: "Imán", ancho_mm: 70, alto_mm: 90, sangrado_mm: 3 })
    expect(validarFormato({ nombre: "Cinta", ancho_cm: 4.8, alto_cm: 100, sangrado_mm: 0 })).toEqual({ nombre: "Cinta", ancho_mm: 48, alto_mm: 1000, sangrado_mm: 0 })
    expect(typeof validarFormato({ nombre: "", ancho_cm: 7, alto_cm: 9 })).toBe("string")
    expect(typeof validarFormato({ nombre: "Gigante", ancho_cm: 400, alto_cm: 9 })).toBe("string")
  })

  it("el número se escribe local y el QR abre el chat correcto", () => {
    expect(numeroLocal("+54 9 11 2622-2202")).toBe("11 2622-2202")
    expect(linkWhatsapp("11 2622-2202")).toBe("https://wa.me/5491126222202")
    expect(linkWhatsapp("+54 9 11 2622-2202")).toBe("https://wa.me/5491126222202")
    expect(linkWhatsapp("123")).toBeNull()
  })

  it("avisa si la foto queda chica", () => {
    expect(avisoFoto(3000, 4000, 827, 1063)).toBeNull()
    expect(avisoFoto(720, 900, 3543, 4724)).toMatch(/chica/)
  })

  it("marca los dpi en el JPG y arma un nombre de archivo limpio", () => {
    const jfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
    const out = conDpi(jfif, 300)
    expect([out[13], (out[14] << 8) | out[15], (out[16] << 8) | out[17]]).toEqual([1, 300, 300])
    // JPG de ffmpeg (sin JFIF, con comentario): se le agrega la cabecera con los dpi.
    const ff = new Uint8Array([0xff, 0xd8, 0xff, 0xfe, 0, 4, 0x4c, 0x61, 0xff, 0xdb])
    const o2 = conDpi(ff, 300)
    expect([o2[2], o2[3], String.fromCharCode(...o2.slice(6, 10)), o2[13], (o2[14] << 8) | o2[15]]).toEqual([0xff, 0xe0, "JFIF", 1, 300])
    expect([...o2.slice(20)]).toEqual([...ff.slice(2)])
    expect(nombreArchivo("Sensaciones de Oriente", { nombre: "Imán 7 × 9 cm", ancho_mm: 70, alto_mm: 90 })).toBe("sensaciones-de-oriente-iman-7-9-cm-7x9cm.jpg")
  })
})

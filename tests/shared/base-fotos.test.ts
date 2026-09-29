import { describe, expect, it } from "vitest"
import { BASE_MAX_BYTES, carpetaDeLink, elegirTanda, esIdDrive } from "../../shared/cos/base-fotos"

const f = (id: string, extra: Partial<{ mimeType: string; size: string; createdTime: string; md5Checksum: string }> = {}) => ({
  id,
  name: `${id}.jpg`,
  mimeType: "image/jpeg",
  path: "",
  createdTime: `2025-01-${id.padStart(2, "0")}T00:00:00Z`,
  ...extra,
})

describe("elegirTanda", () => {
  it("trae los más nuevos primero y respeta el límite", () => {
    const t = elegirTanda([f("1"), f("3"), f("2")], new Set(), new Set(), 2)
    expect(t.elegidos.map((x) => x.id)).toEqual(["3", "2"])
    expect(t.quedan).toBe(1)
    expect(t.total).toBe(3)
  })

  it("no repite lo ya traído ni lo que está en camino", () => {
    const t = elegirTanda([f("1"), f("2"), f("3"), f("4")], new Set(["4"]), new Set(["3"]), 10)
    expect(t.elegidos.map((x) => x.id)).toEqual(["2", "1"])
    expect(t.yaTraidos).toBe(1)
    expect(t.quedan).toBe(0)
  })

  it("separa formatos no soportados y videos demasiado pesados", () => {
    const t = elegirTanda(
      [f("1"), f("2", { mimeType: "application/pdf" }), f("3", { mimeType: "video/mp4", size: String(BASE_MAX_BYTES + 1) }), f("4", { mimeType: "image/heic" })],
      new Set(),
      new Set(),
      10,
    )
    expect(t.elegidos.map((x) => x.id)).toEqual(["4", "1"])
    expect(t.noSoportados).toBe(1)
    expect(t.pesados).toBe(1)
  })

  it("la misma foto copiada en dos carpetas entra una sola vez", () => {
    const t = elegirTanda([f("1", { md5Checksum: "aaa" }), f("2", { md5Checksum: "aaa" }), f("3")], new Set(), new Set(), 10)
    expect(t.elegidos.map((x) => x.id)).toEqual(["3", "2"])
  })

  it("puede traer solo fotos o solo videos", () => {
    const archivos = [f("1"), f("2", { mimeType: "video/mp4" }), f("3", { mimeType: "video/quicktime" }), f("4", { mimeType: "image/png" })]
    const soloVideos = elegirTanda(archivos, new Set(), new Set(), 10, "videos")
    expect(soloVideos.elegidos.map((x) => x.id)).toEqual(["3", "2"])
    expect([soloVideos.fotos, soloVideos.videos]).toEqual([2, 2])
    expect(soloVideos.quedan).toBe(0)
    expect(elegirTanda(archivos, new Set(), new Set(), 10, "fotos").elegidos.map((x) => x.id)).toEqual(["4", "1"])
  })

  it("límite 0 no trae nada", () => {
    expect(elegirTanda([f("1")], new Set(), new Set(), 0).elegidos).toEqual([])
  })
})

describe("carpetaDeLink", () => {
  it("entiende los formatos de link de Drive", () => {
    expect(carpetaDeLink("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing")).toBe("1AbCdEfGhIjKlMnOp")
    expect(carpetaDeLink("https://drive.google.com/drive/u/1/folders/1AbCdEfGhIjKlMnOp")).toBe("1AbCdEfGhIjKlMnOp")
    expect(carpetaDeLink("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp")).toBe("1AbCdEfGhIjKlMnOp")
    expect(carpetaDeLink("1AbCdEfGhIjKlMnOp")).toBe("1AbCdEfGhIjKlMnOp")
  })
  it("rechaza lo que no es un link de carpeta", () => {
    expect(carpetaDeLink("hola")).toBeNull()
    expect(carpetaDeLink("https://google.com")).toBeNull()
  })
})

describe("esIdDrive", () => {
  it("acepta ids reales de Drive (no son UUID)", () => {
    expect(esIdDrive("1AbCdEfGhIjKlMnOp_qR-sT")).toBe(true)
  })
  it("rechaza vacío, basura o intentos de inyectar en la consulta", () => {
    for (const v of [undefined, "", "corto", "abc' or '1'='1", 42]) expect(esIdDrive(v)).toBe(false)
  })
})

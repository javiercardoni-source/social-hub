import { describe, expect, it } from "vitest"
import { CIERRE, CORTE, FUNDIDO, lineaDeTiempo, normalizarGuion, TOMA_MAX } from "../../shared/cos/reel"

const fuentes = [
  { tipo: "video" as const, duracion: 10 },
  { tipo: "foto" as const, duracion: null },
  { tipo: "video" as const, duracion: 0.5 },
]

describe("normalizarGuion", () => {
  it("deja las tomas dentro del video y con largo razonable", () => {
    const g = normalizarGuion({ tomas: [{ fuente: 0, trim_start: 9.5, duracion: 5, movimiento: "acercar" }] }, fuentes)
    expect(g.tomas[0].duracion).toBe(TOMA_MAX)
    expect(g.tomas[0].trim_start).toBeCloseTo(10 - TOMA_MAX)
  })
  it("tira tomas de fuentes que no existen o videos demasiado cortos", () => {
    const g = normalizarGuion({ tomas: [{ fuente: 7 }, { fuente: 2 }, { fuente: 1.5 }, { fuente: 1 }] }, fuentes)
    expect(g.tomas.map((t) => t.fuente)).toEqual([1])
  })
  it("las fotos no tienen trim y la primera toma entra en corte", () => {
    const g = normalizarGuion({ tomas: [{ fuente: 1, trim_start: 4, transicion: "fundido" }, { fuente: 0, transicion: "fundido" }] }, fuentes)
    expect(g.tomas[0]).toMatchObject({ trim_start: 0, transicion: "corte" })
    expect(g.tomas[1].transicion).toBe("fundido")
  })
  it("textos cortos en mayúsculas sin emojis; recuadro solo de la lista; música que exista", () => {
    const g = normalizarGuion(
      { tomas: [{ fuente: 1 }], gancho: "noche de sushi 🍣 #promo", recuadro: "HASTA AGOTAR STOCK", musica: "otra.mp3" },
      fuentes,
      ["a.mp3", "b.mp3"],
    )
    expect(g.gancho).toBe("NOCHE DE SUSHI")
    expect(g.recuadro).toBe("")
    expect(g.musica).toBe("a.mp3")
    expect(g.medio).toBe("") // menos de 3 tomas: no hay texto del medio
  })
})

describe("lineaDeTiempo", () => {
  it("superpone fundidos y cortes y agrega el cierre", () => {
    const l = lineaDeTiempo([
      { duracion: 2, transicion: "corte" },
      { duracion: 2, transicion: "fundido" },
      { duracion: 2, transicion: "corte" },
    ])
    expect(l.inicios[1]).toBeCloseTo(2 - FUNDIDO)
    expect(l.inicios[2]).toBeCloseTo(2 - FUNDIDO + 2 - CORTE)
    expect(l.total).toBeCloseTo(l.inicios[2] + 2 - FUNDIDO + CIERRE)
  })
})

describe("reglas de marca y cierre (F9)", () => {
  it("un texto con una palabra fuera del brandbook se descarta; la tapa usa otro que pasó", async () => {
    const { normalizarGuion } = await import("../../shared/cos/reel")
    const g = normalizarGuion(
      { tomas: [{ fuente: 1 }, { fuente: 1 }, { fuente: 1 }], gancho: "Brindis de amigos", medio: "recién hecho", titulo_cierre: "Noche de sushi" },
      fuentes,
    )
    expect(g.gancho).toBe("NOCHE DE SUSHI")
    expect(g.medio).toBe("")
    const conMarca = normalizarGuion({ tomas: [{ fuente: 1 }], gancho: "sushi gourmet" }, fuentes, [], { prohibidas: ["gourmet"] })
    expect(conMarca.gancho).toBe("")
  })

  it("combo solo si existe en Datos vigentes (sin importar tildes ni mayúsculas)", async () => {
    const { normalizarGuion } = await import("../../shared/cos/reel")
    expect(normalizarGuion({ tomas: [{ fuente: 1 }], combo: "qatar premium " }, fuentes, [], { combos: ["Qatar Premium"] }).combo).toBe("Qatar Premium")
    expect(normalizarGuion({ tomas: [{ fuente: 1 }], combo: "Combo inventado" }, fuentes, [], { combos: ["Qatar Premium"] }).combo).toBe("")
  })

  it("el porqué de cada toma se guarda (corto)", async () => {
    const { normalizarGuion } = await import("../../shared/cos/reel")
    const g = normalizarGuion({ tomas: [{ fuente: 1, por_que: "  arranca   con lo más rico " + "x".repeat(300) }] }, fuentes)
    expect(g.tomas[0].por_que!.startsWith("arranca con lo más rico")).toBe(true)
    expect(g.tomas[0].por_que!.length).toBeLessThanOrEqual(160)
  })

  it("cierre: precio solo del combo activo con precio; pie de zonas cortas o retiro; nada inventado", async () => {
    const { cierreDesdeDatos } = await import("../../shared/cos/reel")
    const datos = { combos: [{ nombre: "Qatar Premium", precio: "$ 31.900", activo: true }, { nombre: "Viejo", precio: "$ 1", activo: false }], zonas: "Paternal y Agronomía", retiro: "" }
    expect(cierreDesdeDatos("Qatar Premium", datos)).toEqual({ precio: "$ 31.900", pie: "ENVÍOS PATERNAL Y AGRONOMÍA" })
    expect(cierreDesdeDatos("Viejo", datos).precio).toBeNull()
    expect(cierreDesdeDatos("", datos).precio).toBeNull()
    expect(cierreDesdeDatos("", { combos: [], zonas: "x".repeat(60), retiro: "Retiro en Av. Siempreviva 742" }).pie).toBe("RETIRO EN AV. SIEMPREVIVA 742")
    expect(cierreDesdeDatos("", { combos: [], zonas: "", retiro: "" })).toEqual({ precio: null, pie: null })
  })

  it("guion de respaldo: siempre hay tomas, dentro de los videos, alternando movimientos", async () => {
    const { guionPorDefecto } = await import("../../shared/cos/reel")
    const g = guionPorDefecto([{ tipo: "video", duracion: 10, cortes: [3, 6] }, { tipo: "foto", duracion: null }], ["a.mp3"])
    expect(g.tomas).toHaveLength(5)
    for (const t of g.tomas.filter((x) => x.fuente === 0)) expect(t.trim_start + t.duracion).toBeLessThanOrEqual(10)
    expect(new Set(g.tomas.map((t) => t.movimiento)).size).toBeGreaterThan(2)
    expect(g.tomas[0].transicion).toBe("corte")
    expect(g.musica).toBe("a.mp3")
    expect(guionPorDefecto([{ tipo: "video", duracion: 0.3 }]).tomas).toHaveLength(0)
  })

  it("la firma del reel cambia con el gancho, la música, el kit y el cierre; no con el porqué", async () => {
    const { firmaReel, normalizarGuion } = await import("../../shared/cos/reel")
    const guion = normalizarGuion({ tomas: [{ fuente: 1, por_que: "a" }], gancho: "hola" }, fuentes)
    const base = { version: "1", guion, gancho: "HOLA", musicaKey: "music/x/a.mp3", fuentes: ["v1"], kitVersion: "", kitMarca: { font: "A" } }
    const f0 = firmaReel(base)
    expect(firmaReel({ ...base, gancho: "CHAU" })).not.toBe(f0)
    expect(firmaReel({ ...base, musicaKey: "music/x/b.mp3" })).not.toBe(f0)
    expect(firmaReel({ ...base, kitVersion: "logo2" })).not.toBe(f0)
    expect(firmaReel({ ...base, kitMarca: { font: "B" } })).not.toBe(f0)
    expect(firmaReel({ ...base, fuentes: ["v1", "v2"] })).not.toBe(f0)
    expect(firmaReel({ ...base, guion: { ...guion, cierre: { precio: "$ 1", pie: null } } })).not.toBe(f0)
    expect(firmaReel({ ...base, guion: { ...guion, tomas: guion.tomas.map((t) => ({ ...t, por_que: "otro" })) } })).toBe(f0)
  })
})

describe("ritmo ráfaga", () => {
  const fuentes = [{ tipo: "video" as const, duracion: 20 }, { tipo: "foto" as const, duracion: null }]
  it("acepta tomas cortas y muchas, todas con corte seco", () => {
    const tomas = Array.from({ length: 30 }, (_, i) => ({ fuente: i % 2, trim_start: i * 0.5, duracion: 0.6, transicion: "fundido" }))
    const g = normalizarGuion({ tomas, gancho: "armá tus 5" }, fuentes, [], { ritmo: "rafaga" })
    expect(g.tomas).toHaveLength(24)
    expect(g.tomas.every((t) => t.duracion === 0.6 && t.transicion === "corte")).toBe(true)
    expect(g.ritmo).toBe("rafaga")
  })
  it("normal sigue igual (sin ritmo en el guion)", () => {
    const g = normalizarGuion({ tomas: [{ fuente: 0, duracion: 0.6 }] }, fuentes)
    expect(g.tomas[0].duracion).toBe(1.5)
    expect(g.ritmo).toBeUndefined()
  })
  it("en ráfaga los clips no se superponen", () => {
    const l = lineaDeTiempo([{ duracion: 0.5, transicion: "corte" }, { duracion: 0.5, transicion: "corte" }], "rafaga")
    expect(l.inicios).toEqual([0, 0.5])
  })
})

describe("palabra por corte (karaoke)", () => {
  const fuentes = [{ tipo: "video" as const, duracion: 20 }]
  const tomas = Array.from({ length: 4 }, (_, i) => ({ fuente: 0, trim_start: i, duracion: 0.6 }))
  it("una palabra por toma, del mismo largo, y marcos inclinados", () => {
    const g = normalizarGuion({ tomas, palabras: ["armá", "tus", "cinco"] }, fuentes, [], { ritmo: "rafaga", karaoke: true })
    expect(g.palabras).toEqual(["ARMÁ", "TUS", "CINCO", ""])
    expect(g.inclinado).toBe(true)
  })
  it("con precio o palabra prohibida no se ponen palabras", () => {
    expect(normalizarGuion({ tomas, palabras: ["solo", "$15.000"] }, fuentes, [], { ritmo: "rafaga", karaoke: true }).palabras).toBeUndefined()
    expect(normalizarGuion({ tomas, palabras: ["últimos", "cupos"] }, fuentes, [], { ritmo: "rafaga", karaoke: true }).palabras).toBeUndefined()
  })
  it("sin la opción de la marca, nada", () => {
    const g = normalizarGuion({ tomas, palabras: ["armá"] }, fuentes, [], { ritmo: "rafaga" })
    expect(g.palabras).toBeUndefined()
    expect(g.inclinado).toBeUndefined()
  })
})

import { describe, expect, it } from "vitest"
import {
  ACCION_CONVERSACION,
  aprendizaje,
  desdeCentavos,
  elegirPlantilla,
  elegirTanda,
  grupoTitular,
  guionRearmado,
  titularVigente,
  guionReedicion,
  leerInsights,
  porQueAnuncio,
  problemasCopy,
  rankearAnuncios,
  tipoCreativo,
  tramosLimpios,
} from "../../shared/cos/ads"

describe("insights de Meta", () => {
  it("las conversaciones y su costo salen de la API, no de spend/conversaciones", () => {
    const n = leerInsights({
      spend: "10000",
      impressions: "5000",
      inline_link_clicks: "40",
      actions: [{ action_type: ACCION_CONVERSACION, value: "7" }, { action_type: "onsite_conversion.messaging_first_reply", value: "5" }],
      cost_per_action_type: [{ action_type: ACCION_CONVERSACION, value: "1500.5" }],
    })
    expect(n).toMatchObject({ spend: 10000, impressions: 5000, link_clicks: 40, conversations: 7, first_replies: 5, cost_per_conversation: 1500.5 })
  })
  it("sin conversaciones no hay costo por conversación", () => {
    expect(leerInsights({ spend: "300", actions: [] }).cost_per_conversation).toBeNull()
  })
  it("presupuestos en centavos", () => {
    expect(desdeCentavos("1500000")).toBe(15000)
    expect(desdeCentavos("0")).toBeNull()
  })
})

describe("tipo de creativo", () => {
  it("distingue video, imagen, carrusel y publicación existente", () => {
    expect(tipoCreativo({ object_story_spec: { video_data: { video_id: "1" } } })).toBe("video")
    expect(tipoCreativo({ object_story_spec: { link_data: { image_hash: "h" } } })).toBe("imagen")
    expect(tipoCreativo({ object_story_spec: { link_data: { child_attachments: [{}, {}] } } })).toBe("carrusel")
    expect(tipoCreativo({ object_type: "SHARE", effective_instagram_media_id: "17" })).toBe("post")
  })
})

describe("ranking", () => {
  const ad = (id: string, cpc: number, conv: number) => ({ id, totals: { spend: cpc * conv, conversations: conv, cost_per_conversation: cpc } })
  it("lo barato con volumen gana; lo que gastó poco no entra", () => {
    const r = rankearAnuncios([ad("caro", 3000, 50), ad("bueno", 1000, 120), ad("medio", 2000, 40), ad("suerte", 200, 3), { id: "nada", totals: { spend: 500 } }])
    expect(r.habitual).toBe(2000)
    expect(r.ganadores.map((g) => g.id)).toEqual(["bueno", "medio", "caro"])
    expect(r.sinDatos).toEqual(expect.arrayContaining(["suerte", "nada"]))
    expect(r.ganadores[0].vsMarca).toBeCloseTo(1000 / 2000)
  })
  it("el por qué usa los números de la API", () => {
    expect(porQueAnuncio({ cost_per_conversation: 1000, spend: 120000, conversations: 120 }, 1500)).toBe(
      "$1.000 por conversación con $120.000 invertidos y 120 conversaciones: 33 % más barato que lo habitual de la marca ($1.500).",
    )
  })
})

describe("re-edición", () => {
  it("une cuadros limpios y deja afuera lo que tiene precio", () => {
    const cuadros = [0.5, 2, 3.5, 5, 6.5, 8, 9.5].map((t) => ({ t, limpio: t < 6 }))
    const tr = tramosLimpios(cuadros, 10)
    expect(tr).toHaveLength(1)
    expect(tr[0][0]).toBe(0)
    expect(tr[0][1]).toBeLessThan(5.75)
  })
  it("arma tomas solo de lo limpio y la placa final va sin precio", () => {
    const g = guionReedicion([[0, 5.6], [7, 9.5]], { gancho: "Armá tus 5", tituloCierre: "Pedí por WhatsApp", recuadro: "DELIVERY", pie: null, idea: "x" })
    expect(g).not.toBeNull()
    expect(g!.tomas.length).toBeGreaterThanOrEqual(2)
    for (const t of g!.tomas) {
      const dentro = (t.trim_start >= 0 && t.trim_start + t.duracion <= 5.6 + 0.01) || (t.trim_start >= 7 && t.trim_start + t.duracion <= 9.5 + 0.01)
      expect(dentro).toBe(true)
    }
    expect(g!.cierre).toEqual({ precio: null, pie: null })
  })
  it("sin material limpio suficiente no hay guion", () => {
    expect(guionReedicion([[0, 1.6]], { gancho: "", tituloCierre: "", recuadro: "", pie: null, idea: "" })).toBeNull()
  })
})

describe("rearmado sobre fotos reales", () => {
  it("una toma por fuente, titular arriba y cierre sin precio", () => {
    const g = guionRearmado([{ tipo: "foto", duracion: null }, { tipo: "video", duracion: 8 }], { gancho: "40 piezas todo salmón", tituloCierre: "Pedí por WhatsApp", recuadro: "", pie: "ENVÍOS CABA", idea: "x" })!
    expect(g.tomas.map((t) => t.fuente)).toEqual([0, 1])
    expect(g.tomas[1].trim_start).toBe(0.6)
    expect(g.cierre).toEqual({ precio: null, pie: "ENVÍOS CABA" })
  })
  it("con una sola foto arma dos tomas; sin fuentes, nada", () => {
    expect(guionRearmado([{ tipo: "foto", duracion: null }], { gancho: "", tituloCierre: "", recuadro: "", pie: null, idea: "" })!.tomas).toHaveLength(2)
    expect(guionRearmado([], { gancho: "", tituloCierre: "", recuadro: "", pie: null, idea: "" })).toBeNull()
  })
  it("con texto del medio, asegura la tercera toma (ahí aparece)", () => {
    const g = guionRearmado([{ tipo: "foto", duracion: null }], { gancho: "Puro salmón 40 piezas", medio: "Comé en casa", tituloCierre: "", recuadro: "", pie: null, idea: "" })!
    expect(g.medio).toBe("Comé en casa")
    expect(g.tomas).toHaveLength(3)
    expect(new Set(g.tomas.map((t) => t.movimiento)).size).toBe(3)
    expect(guionRearmado([{ tipo: "foto", duracion: null }], { gancho: "x", tituloCierre: "", recuadro: "", pie: null, idea: "" })!.medio).toBe("")
  })
})

describe("textos", () => {
  it("nada de sin TACC ni precios que no están vigentes", () => {
    expect(problemasCopy({ title: "Combo · $15.000", body: "Apto celíacos" }, ["$15.000"])).toEqual(["menciona «sin TACC / gluten / celíacos»"])
    expect(problemasCopy({ title: "Combo", body: "A $12.000" }, ["$15.000"])).toEqual(["precio que no está vigente: $12.000"])
    expect(problemasCopy({ title: "Combo 5 Onigiris · $15.000", body: "5 onigiris, elegís los sabores." }, ["$ 15.000"])).toEqual([])
  })
})

describe("aprendizaje y tanda", () => {
  it("cuenta solo lo medido y suaviza la tasa", () => {
    const a = aprendizaje([
      { kind: "reeditar", nuevo: { cost_per_conversation: 800, spend: 8000, conversations: 10 }, origen: 1000 },
      { kind: "reeditar", nuevo: { cost_per_conversation: 900, spend: 9000, conversations: 10 }, origen: 1000 },
      { kind: "reusar", nuevo: { cost_per_conversation: 1500, spend: 15000, conversations: 10 }, origen: 1000 },
      { kind: "organico", nuevo: { cost_per_conversation: 100, spend: 200, conversations: 2 }, origen: 1000 },
    ])
    expect(a.reeditar).toEqual({ medidos: 2, ganados: 2, tasa: 0.75 })
    expect(a.reusar.tasa).toBeCloseTo(1 / 3)
    expect(a.organico.medidos).toBe(0)
  })
  it("rescata con re-edición el ganador que tenía precio quemado y no repite fuentes", () => {
    const t = elegirTanda({
      ganadores: [
        { id: "a", apto: false, reeditable: true, tienePieza: true },
        { id: "b", apto: true, reeditable: true, tienePieza: true },
        { id: "c", apto: true, reeditable: false, tienePieza: true },
      ],
      organicos: [{ media_id: "m1", apto: true }],
      usados: new Set(["media:m1"]),
      combosActivos: 3,
    })
    expect(t[0]).toEqual({ kind: "reusar", ad_id: "b" })
    expect(t).toContainEqual({ kind: "reeditar", ad_id: "a" })
    expect(t.some((e) => e.kind === "organico")).toBe(false)
    expect(t.find((e) => e.kind === "variante")?.ad_id).toBe("c")
    expect(t.length).toBeLessThanOrEqual(5)
    expect(t.filter((e) => e.kind === "reeditar").length).toBeGreaterThanOrEqual(1)
    expect(new Set(t.map((e) => e.ad_id ?? e.media_id)).size).toBe(t.length)
  })
})

describe("tanda con un solo tipo de material", () => {
  it("si todo es re-editable, igual arma hasta 5", () => {
    const g = Array.from({ length: 7 }, (_, i) => ({ id: `g${i}`, apto: false, reeditable: true, tienePieza: true }))
    const t = elegirTanda({ ganadores: g, organicos: [], usados: new Set(), combosActivos: 0 })
    expect(t).toHaveLength(5)
    expect(t.every((e) => e.kind === "reeditar")).toBe(true)
  })
})

describe("diseños repetidos", () => {
  it("dos ganadores con el mismo titular no van en la misma tanda", () => {
    const g = [
      { id: "a", apto: false, reeditable: true, tienePieza: true, grupo: "40 piezas todo salmon" },
      { id: "b", apto: false, reeditable: true, tienePieza: true, grupo: "40 piezas todo salmon" },
      { id: "c", apto: false, reeditable: true, tienePieza: true, grupo: "mas sushi" },
    ]
    const t = elegirTanda({ ganadores: g, organicos: [], usados: new Set(), combosActivos: 0 })
    expect(t.map((e) => e.ad_id)).toEqual(["a", "c"])
  })
})

describe("titulares", () => {
  it("el mismo diseño con otra escritura es el mismo grupo", () => {
    expect(grupoTitular("40 PIEZAS · TODO SALMON LARGE")).toBe(grupoTitular("40 piezas · Todo salmón Large"))
    expect(grupoTitular("")).toBeUndefined()
  })
  it("los de fechas especiales no se rearman", () => {
    expect(titularVigente("Amor · No improvises, reservá")).toBe("")
    expect(titularVigente("Edición Otoño")).toBe("")
    expect(titularVigente("Punto retiro Paternal · Envíos CABA")).toBe("")
    expect(titularVigente("40 piezas · Todo salmón Large")).toBe("40 piezas · Todo salmón Large")
  })
})

describe("plantilla del conjunto", () => {
  const ad = (id: string, objective: string, cta: string, cpc: number | null, conv = 50) => ({ id, objective, cta_type: cta, adset_id: `as-${id}`, last_date: "2026-09-01", effective_status: "PAUSED" as string | null, totals: { conversations: conv, cost_per_conversation: cpc } })
  it("usa el del ganador si su objetivo es nuevo", () => {
    const src = ad("g", "OUTCOME_ENGAGEMENT", "INSTAGRAM_MESSAGE", 400)
    expect(elegirPlantilla(src, [src])?.id).toBe("g")
  })
  it("si el ganador es de objetivo viejo, el mejor de mensajes con objetivo nuevo y mismo destino", () => {
    const src = ad("viejo", "MESSAGES", "WHATSAPP_MESSAGE", 800)
    const todos = [src, ad("trafico", "OUTCOME_TRAFFIC", "LEARN_MORE", 100), ad("msgr", "OUTCOME_ENGAGEMENT", "MESSAGE_PAGE", 500), ad("wa-caro", "OUTCOME_ENGAGEMENT", "WHATSAPP_MESSAGE", 1500), ad("wa", "OUTCOME_ENGAGEMENT", "WHATSAPP_MESSAGE", 1200)]
    expect(elegirPlantilla(src, todos)?.id).toBe("wa")
    expect(elegirPlantilla(null, todos)?.id).toBe("msgr")
    // Tráfico con botón de WhatsApp solo si no hay de Interacción.
    expect(elegirPlantilla(src, [src, ad("tr-wa", "OUTCOME_TRAFFIC", "WHATSAPP_MESSAGE", 300), ad("eng", "OUTCOME_ENGAGEMENT", "MESSAGE_PAGE", 900)])?.id).toBe("eng")
    expect(elegirPlantilla(src, [src])).toBeNull()
    expect(elegirPlantilla(src, [{ ...ad("wa", "OUTCOME_ENGAGEMENT", "WHATSAPP_MESSAGE", 900), effective_status: "ARCHIVED" }])).toBeNull()
  })
})

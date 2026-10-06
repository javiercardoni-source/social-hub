import { describe, expect, it } from "vitest"
import { cortesDesdeTomas, idPlantilla, leerCapcut, leerOgVideo, tipoDeLink } from "../../shared/cos/referencia-link"
import { ajustarAlPulso, alPulso, perfilMusical, ritmoDeReferencias } from "../../shared/cos/ritmo"

// Pedazo con la misma forma que la página pública de una plantilla (JSON embebido, / y segment_config en texto).
const HTML = `<script>{"template":{"cover_url":"https:\\u002F\\u002Fp16.example.com\\u002Fc.image","video_url":"https:\\u002F\\u002Fv16-cc.capcut.com\\u002Fabc\\u002Fvideo\\u002F?a=1&b=2","extra_v2":{"segment_config":"{\\"target_timerange_list\\":[{\\"start\\":673600,\\"duration\\":787729},{\\"start\\":0,\\"duration\\":673600},{\\"start\\":1461329,\\"duration\\":784538}]}"}}}</script>`

describe("referencia por link", () => {
  it("reconoce de dónde es el link", () => {
    expect(tipoDeLink("https://www.capcut.com/templates/7367553676510006534?scene=category")).toBe("capcut")
    expect(tipoDeLink("https://www.instagram.com/reel/abc/")).toBe("instagram")
    expect(tipoDeLink("https://vm.tiktok.com/xyz")).toBe("tiktok")
    expect(tipoDeLink("http://capcut.com/x")).toBeNull()
    expect(tipoDeLink("no es un link")).toBeNull()
  })
  it("de una plantilla de CapCut saca el video y la duración exacta de cada toma, en orden", () => {
    const p = leerCapcut(HTML)!
    expect(p.videoUrl).toBe("https://v16-cc.capcut.com/abc/video/?a=1&b=2")
    expect(p.tomas).toEqual([0.674, 0.788, 0.785])
    expect(p.duracion).toBe(2.25)
    expect(cortesDesdeTomas(p.tomas)).toEqual([0.674, 1.462])
    expect(leerCapcut("<html></html>")).toBeNull()
  })
  it("con varias plantillas en la página, toma la del link (no una relacionada)", () => {
    const rel = `{"video_url":"https:\\u002F\\u002Fotra.capcut.com\\u002Frelacionada","web_id":"111"}`
    const mia = `{"video_url":"https:\\u002F\\u002Fv16.capcut.com\\u002Fmia","web_id":"7364525986605485317","extra_v2":{"segment_config":"{\\"target_timerange_list\\":[{\\"start\\":0,\\"duration\\":500000}]}"}}`
    const html = `<script>${rel}${mia}</script>`
    expect(idPlantilla("https://www.capcut.com/templates/7364525986605485317?scene=category")).toBe("7364525986605485317")
    expect(leerCapcut(html, "7364525986605485317")?.videoUrl).toBe("https://v16.capcut.com/mia")
    expect(leerCapcut(html, "7364525986605485317")?.tomas).toEqual([0.5])
  })
  it("plantilla de imagen: sin video, se toma el diseño completo", () => {
    const html = `<script>{"cover_url":"https:\\u002F\\u002Fp16.capcut.com\\u002Fdiseno.image","video_url":"","web_id":"7367066114683079941"}</script>`
    expect(leerCapcut(html, "7367066114683079941")).toEqual({ videoUrl: null, imagenUrl: "https://p16.capcut.com/diseno.image", tomas: [], duracion: null, portada: "https://p16.capcut.com/diseno.image" })
  })
  it("plan B: og:video", () => {
    expect(leerOgVideo('<meta property="og:video" content="https://x.com/v.mp4?a=1&amp;b=2">')).toBe("https://x.com/v.mp4?a=1&b=2")
  })
})

describe("ritmo ráfaga", () => {
  it("la marca va en ráfaga si la mayoría de sus referencias de reels son rápidas", () => {
    expect(ritmoDeReferencias([{ toma_promedio_s: 0.7 }, { toma_promedio_s: 0.8 }, { toma_promedio_s: 2.2 }])).toBe("rafaga")
    expect(ritmoDeReferencias([{ toma_promedio_s: 0.7 }, { toma_promedio_s: 2.2 }])).toBe("normal")
    expect(ritmoDeReferencias([])).toBe("normal")
  })
  it("las tomas pasan a múltiplos del pulso (120 BPM = 0,5 s)", () => {
    const t = ajustarAlPulso([{ duracion: 0.7 }, { duracion: 1.1 }, { duracion: 0.3 }], 120, "rafaga")
    expect(t.map((x) => x.duracion)).toEqual([0.5, 1, 0.5])
    expect(ajustarAlPulso([{ duracion: 2.3 }], 120, "normal")[0].duracion).toBe(2.5)
    expect(ajustarAlPulso([{ duracion: 0.7 }], null, "rafaga")[0].duracion).toBe(0.7)
  })
  it("mide qué parte de los cortes cae al pulso", () => {
    expect(alPulso([0.75, 0.75, 1.5, 0.6], 80)).toBe(75)
  })
  it("perfil musical: BPM mediano, rango y energía", () => {
    expect(perfilMusical([{ bpm: 120, energia: 0.8 }, { bpm: 128, energia: 0.7 }, { bpm: 90, confianza: 0.1, energia: 0.9 }])).toEqual({ n: 3, bpm: 128, bpmMin: 120, bpmMax: 128, energia: "alta" })
    expect(perfilMusical([])).toEqual({ n: 0, bpm: null, bpmMin: null, bpmMax: null, energia: null })
  })
})

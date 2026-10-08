import { describe, expect, it } from "vitest"
import { puntajeDePieza } from "../../worker/src/agenda"

const pieza = (x: { quality?: number | null; comercial?: number; qa?: number; avisos?: string[]; respaldo?: boolean; flags?: string[] }) => ({
  avisos: x.avisos ?? [],
  montaje: x.respaldo ? { respaldo: true } : null,
  render_qa: x.qa != null ? { score: x.qa } : null,
  cos_post_media: [{ position: 0, cos_asset_versions: { asset_id: "a", cos_assets: { quality_score: x.quality ?? null, ai_json: { commercial_value: x.comercial, risk_flags: x.flags } } } }],
})

describe("puntajeDePieza (replan del mes: las mejores primero)", () => {
  it("premia calidad, valor comercial y revisión visual", () => {
    expect(puntajeDePieza(pieza({ quality: 90, comercial: 80, qa: 100 }))).toBe(90 + 40 + 50)
    expect(puntajeDePieza(pieza({ quality: 40, comercial: 20, qa: 50 }))).toBe(40 + 10 + 25)
  })
  it("castiga avisos de ingredientes, guion de respaldo y alertas", () => {
    const base = puntajeDePieza(pieza({ quality: 80, comercial: 60, qa: 80 }))
    expect(puntajeDePieza(pieza({ quality: 80, comercial: 60, qa: 80, avisos: ["x"] }))).toBe(base - 30)
    expect(puntajeDePieza(pieza({ quality: 80, comercial: 60, qa: 80, respaldo: true }))).toBe(base - 20)
    expect(puntajeDePieza(pieza({ quality: 80, comercial: 60, qa: 80, flags: ["baja_calidad", "marca_ajena"] }))).toBe(base - 20)
  })
  it("sin datos usa valores medios (no descarta por falta de ficha)", () => {
    expect(puntajeDePieza(pieza({}))).toBe(50 + 25 + 35)
  })
})

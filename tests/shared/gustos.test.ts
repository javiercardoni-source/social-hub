/**
 * F7 M0 — vocabulario cerrado, ficha de audio y tope del backfill (shared/cos/gustos.ts).
 */
import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  BPM_CONFIANZA_MIN,
  GENEROS,
  MOODS,
  RASGOS,
  analizarAudio,
  costoUsd,
  energiaDesdeRms,
  esRutaDeMusica,
  normalizarEtiquetas,
  normalizarRasgos,
  ritmoDeCortes,
  tandaDentroDelTope,
  tituloTema,
} from "../../shared/cos/gustos"
import { freshDb } from "../db/harness"

const SR = 11025

/** Clicks secos a un tempo dado (con un poco de ruido de fondo), en float mono. */
function clicks(bpm: number, segundos = 30, ruido = 0.01): Float32Array {
  const x = new Float32Array(SR * segundos)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  for (let i = 0; i < x.length; i++) x[i] = rnd() * ruido
  const periodo = (60 / bpm) * SR
  for (let t = 0; t < x.length; t += periodo) {
    const i0 = Math.round(t)
    for (let k = 0; k < 400 && i0 + k < x.length; k++) x[i0 + k] += 0.8 * Math.exp(-k / 60) * Math.sin(k * 0.9)
  }
  return x
}

describe("vocabulario cerrado", () => {
  it("un valor fuera de la lista se descarta, no se corrige", () => {
    const r = normalizarRasgos({ plano: "vista desde arriba", protagonista: "producto", accion: "vapor", luz_temp: "tibia", fondo: "limpio", extra: "x" })
    expect(r.plano).toBeNull()
    expect(r.luz_temp).toBeNull()
    expect(r.protagonista).toBe("producto")
    expect(r.accion).toBe("vapor")
    expect(r.fondo).toBe("limpio")
    expect(r.luz_nivel).toBeNull()
    expect(r).not.toHaveProperty("extra")
  })

  it("ritmo y duración solo si son números razonables", () => {
    expect(normalizarRasgos({ ritmo: 1.234, duracion_s: 12 }).ritmo).toBe(1.23)
    expect(normalizarRasgos({ ritmo: -1 }).ritmo).toBeNull()
    expect(normalizarRasgos({ ritmo: "2" }).ritmo).toBeNull()
    expect(normalizarRasgos({ duracion_s: Number.NaN }).duracion_s).toBeNull()
    expect(normalizarRasgos(null)).toMatchObject({ plano: null, ritmo: null })
  })

  it("etiquetas de música: género único, moods sin repetir y en orden fijo", () => {
    expect(normalizarEtiquetas({ genre: "jazz", mood: ["romantico", "relajado", "relajado", "triste"], vocals: false })).toEqual({
      genre: "jazz",
      mood: ["relajado", "romantico"],
      vocals: false,
    })
    expect(normalizarEtiquetas({ genre: "cumbia", mood: "arriba", vocals: "si" })).toEqual({ genre: null, mood: [], vocals: null })
  })

  it("los vocabularios de la base son los mismos que los de TypeScript", async () => {
    const db = await freshDb()
    const defs = await db.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(c.oid) as def from pg_constraint c
       where c.conrelid = 'cos_music_tracks'::regclass and c.contype = 'c'`,
    )
    const def = (col: string) => defs.rows.find((r) => r.def.includes(`(${col}`) || r.def.includes(`${col} `))!.def
    const valores = (d: string) => [...d.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    expect(valores(def("genre"))).toEqual([...GENEROS].sort())
    expect(valores(def("mood"))).toEqual([...MOODS].sort())
  })

  it("los rasgos son listas cerradas y sin repetidos", () => {
    for (const vals of Object.values(RASGOS)) expect(new Set(vals).size).toBe(vals.length)
  })
})

describe("biblioteca de música", () => {
  it("título legible sin el sufijo de la subida", () => {
    expect(tituloTema("music/bijutsukan/Piano-Jazz-Night-a1b2c3.mp3")).toBe("Piano Jazz Night")
    expect(tituloTema("music/fasutofudo/house_urbano.m4a")).toBe("house urbano")
  })

  it("solo rutas de la carpeta de la marca", () => {
    expect(esRutaDeMusica("music/sensaciones/tema.mp3", "sensaciones")).toBe(true)
    expect(esRutaDeMusica("music/sensaciones/tema.mp3", "bijutsukan")).toBe(false)
    expect(esRutaDeMusica("music/sensaciones/../x/tema.mp3")).toBe(false)
    expect(esRutaDeMusica("music/sensaciones/tema.exe")).toBe(false)
    expect(esRutaDeMusica("brand/sensaciones/logo/tema.mp3")).toBe(false)
  })
})

describe("ficha de audio", () => {
  it.each([90, 120, 128, 150])("encuentra el tempo de un pulso claro a %i BPM", (bpm) => {
    const r = analizarAudio(clicks(bpm), SR)
    expect(r.bpmConfianza).toBeGreaterThanOrEqual(BPM_CONFIANZA_MIN)
    expect(r.bpm).not.toBeNull()
    expect(Math.abs(r.bpm! - bpm)).toBeLessThanOrEqual(3)
  })

  it("sin pulso (ruido) no inventa un BPM", () => {
    expect(analizarAudio(new Float32Array(SR * 20), SR).bpm).toBeNull() // silencio
    let seed = 3
    const ruido = new Float32Array(SR * 20).map(() => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1)
    const n = analizarAudio(ruido, SR)
    expect(n.bpm).toBeNull()
  })

  it("muy corto: no mide el tempo", () => {
    expect(analizarAudio(clicks(120, 3), SR).bpm).toBeNull()
  })

  it("la energía crece con el volumen y queda entre 0 y 1", () => {
    const bajo = analizarAudio(clicks(120, 20).map((v) => v * 0.05), SR)
    const alto = analizarAudio(clicks(120, 20).map((v) => v * 1.2), SR)
    expect(alto.energy).toBeGreaterThan(bajo.energy)
    expect(energiaDesdeRms(-120)).toBe(0)
    expect(energiaDesdeRms(0)).toBe(1)
    expect(energiaDesdeRms(-18)).toBe(0.5)
  })

  // Punta a punta como en el worker: un WAV real → ffmpeg lo decodifica → ficha.
  const hayFfmpeg = (() => {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
      return true
    } catch {
      return false
    }
  })()
  it.skipIf(!hayFfmpeg)("un WAV de prueba pasa por ffmpeg y da el tempo correcto", () => {
    const x = clicks(124, 20)
    const pcm = Buffer.alloc(x.length * 2)
    x.forEach((v, i) => pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2))
    // Encabezado WAV PCM 16 bits mono.
    const h = Buffer.alloc(44)
    h.write("RIFF", 0)
    h.writeUInt32LE(36 + pcm.length, 4)
    h.write("WAVEfmt ", 8)
    h.writeUInt32LE(16, 16)
    h.writeUInt16LE(1, 20)
    h.writeUInt16LE(1, 22)
    h.writeUInt32LE(SR, 24)
    h.writeUInt32LE(SR * 2, 28)
    h.writeUInt16LE(2, 32)
    h.writeUInt16LE(16, 34)
    h.write("data", 36)
    h.writeUInt32LE(pcm.length, 40)
    const dir = mkdtempSync(join(tmpdir(), "gustos-"))
    try {
      const f = join(dir, "t.wav")
      writeFileSync(f, Buffer.concat([h, pcm]))
      // Mismos parámetros que decodeAudio (worker/src/media.ts).
      const out = execFileSync("ffmpeg", ["-v", "error", "-i", f, "-t", "120", "-ac", "1", "-ar", String(SR), "-f", "f32le", "pipe:1"], { maxBuffer: 64 * 1024 * 1024 })
      const samples = new Float32Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength - (out.byteLength % 4)))
      const r = analizarAudio(samples, SR)
      expect(Math.abs(r.bpm! - 124)).toBeLessThanOrEqual(3)
      expect(r.energy).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("ritmo de edición", () => {
  it("cortes por segundo", () => {
    expect(ritmoDeCortes([1, 2, 3, 4], 8)).toBe(0.5)
    expect(ritmoDeCortes([], 10)).toBe(0)
    expect(ritmoDeCortes([1], null)).toBeNull()
  })
})

describe("backfill de rasgos: tope de gasto", () => {
  const base = { pendientes: 3000, gastadoUsd: 0, topeUsd: 15, porItemUsd: 0.004, tanda: 25 }
  it("respeta la tanda", () => expect(tandaDentroDelTope(base)).toBe(25))
  it("no se pasa del tope aunque cada uno cueste lo estimado", () => {
    expect(tandaDentroDelTope({ ...base, gastadoUsd: 14.95 })).toBe(12)
    expect(tandaDentroDelTope({ ...base, gastadoUsd: 14.999 })).toBe(0)
    expect(tandaDentroDelTope({ ...base, gastadoUsd: 15 })).toBe(0)
    expect(tandaDentroDelTope({ ...base, gastadoUsd: 20 })).toBe(0)
  })
  it("tope en cero = no hace nada", () => expect(tandaDentroDelTope({ ...base, topeUsd: 0 })).toBe(0))
  it("sin pendientes = terminado", () => expect(tandaDentroDelTope({ ...base, pendientes: 0 })).toBe(0))
  it("no pide más que lo que queda", () => expect(tandaDentroDelTope({ ...base, pendientes: 4 })).toBe(4))
  it("idempotente: con lo mismo pendiente y gastado, la misma tanda", () => {
    expect(tandaDentroDelTope({ ...base, gastadoUsd: 3 })).toBe(tandaDentroDelTope({ ...base, gastadoUsd: 3 }))
  })

  it("costo: Haiku por precio de lista, y un modelo desconocido cuenta como caro", () => {
    expect(costoUsd("claude-haiku-4-5", { input: 1_000_000, output: 0 })).toBeCloseTo(1)
    expect(costoUsd("claude-haiku-4-5-20251001", { input: 0, output: 1_000_000 })).toBeCloseTo(5)
    expect(costoUsd("modelo-raro", { input: 1_000_000, output: 0 })).toBeGreaterThan(3)
  })
})

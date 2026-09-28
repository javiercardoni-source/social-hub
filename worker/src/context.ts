/**
 * F4 — Contexto (feriados, fechas especiales, clima). Lo sincroniza el trabajo `context:sync`
 * y lo usa la IA al escribir: solo datos reales, nunca inventados.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { isDeliveryDay, specialDaysFor, weatherText } from "../../shared/cos/special-days.ts"

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
/** Fecha YYYY-MM-DD en Buenos Aires (UTC−3 fijo). */
export const arDay = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10)

type DayRow = { day: string; name: string; kind: string; brand_id: string | null; source: string; hint: string | null }

/** Inserta lo que falte (la clave natural es fecha + nombre + marca). Idempotente. */
async function insertMissing(db: SupabaseClient, rows: DayRow[]) {
  if (!rows.length) return 0
  const days = [...new Set(rows.map((r) => r.day))]
  const { data: existing, error } = await db.from("cos_special_days").select("day, name, brand_id").in("day", days)
  if (error) throw new Error(`cos_special_days: ${error.message}`)
  const have = new Set((existing ?? []).map((e) => `${e.day}|${e.name}|${e.brand_id ?? ""}`))
  const missing = rows.filter((r) => !have.has(`${r.day}|${r.name}|${r.brand_id ?? ""}`))
  if (!missing.length) return 0
  const { error: ie } = await db.from("cos_special_days").insert(missing)
  if (ie) throw new Error(`cos_special_days: ${ie.message}`)
  return missing.length
}

export async function syncContext(db: SupabaseClient) {
  const year = Number(arDay(new Date()).slice(0, 4))
  let feriados = 0
  for (const y of [year, year + 1]) {
    // Los feriados del año siguiente se publican tarde: si todavía no están, no es un error.
    const res = await fetch(`https://api.argentinadatos.com/v1/feriados/${y}`).catch(() => null)
    if (!res?.ok) continue
    const list = (await res.json()) as { fecha: string; tipo: string; nombre: string }[]
    feriados += await insertMissing(
      db,
      list.map((f) => ({
        day: f.fecha,
        name: f.nombre,
        kind: f.tipo === "puente" ? "puente" : "feriado",
        brand_id: null,
        source: "argentinadatos",
        hint: f.tipo === "puente" ? "Fin de semana largo: más gente en casa o de escapada" : "Feriado: la gente está en casa, se comporta como un domingo",
      })),
    )
  }
  const especiales = await insertMissing(
    db,
    [...specialDaysFor(year), ...specialDaysFor(year + 1)].map((d) => ({ day: d.day, name: d.name, kind: "especial", brand_id: null, source: "curado", hint: d.hint })),
  )

  // Clima de Buenos Aires, 7 días.
  const w = await fetch(
    "https://api.open-meteo.com/v1/forecast?latitude=-34.61&longitude=-58.38&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=America%2FArgentina%2FBuenos_Aires&forecast_days=7",
  )
  if (!w.ok) throw new Error(`clima: HTTP ${w.status}`)
  const d = ((await w.json()) as { daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] } }).daily
  const rows = d.time.map((day, i) => ({
    day,
    code: d.weather_code[i],
    tmax: d.temperature_2m_max[i],
    tmin: d.temperature_2m_min[i],
    rain_prob: d.precipitation_probability_max[i],
    updated_at: new Date().toISOString(),
  }))
  const { error } = await db.from("cos_weather_daily").upsert(rows, { onConflict: "day" })
  if (error) throw new Error(`cos_weather_daily: ${error.message}`)
  return { feriados, especiales, clima: rows.length }
}

/**
 * Contexto real de hoy y mañana para la IA: fechas especiales (globales y de la marca) y clima.
 * Devuelve "" si no hay nada que valga la pena.
 */
export async function contextForBrand(db: SupabaseClient, brandId: string, from = new Date()): Promise<string> {
  const days = [0, 1, 2].map((n) => arDay(new Date(from.getTime() + n * 86_400_000)))
  const [{ data: sd }, { data: wx }] = await Promise.all([
    db.from("cos_special_days").select("day, name, kind, brand_id, hint").in("day", days).or(`brand_id.is.null,brand_id.eq.${brandId}`),
    db.from("cos_weather_daily").select("day, code, tmax, tmin, rain_prob").in("day", days.slice(0, 2)),
  ])
  const label = (day: string) => {
    const i = days.indexOf(day)
    const dow = DIAS[new Date(`${day}T12:00:00Z`).getUTCDay()]
    return i === 0 ? `hoy (${dow} ${day.slice(8)}/${day.slice(5, 7)})` : i === 1 ? `mañana (${dow})` : `pasado mañana (${dow})`
  }
  const lines: string[] = []
  for (const s of sd ?? []) lines.push(`- ${label(s.day)}: ${s.name}${s.hint ? ` — idea: ${s.hint}` : ""}`)
  for (const w of wx ?? []) {
    const deliv = isDeliveryDay(w) ? " → día de delivery" : ""
    lines.push(`- Clima ${label(w.day)}: ${weatherText(w.code)}, máx ${Math.round(w.tmax)}°, mín ${Math.round(w.tmin)}°, lluvia ${w.rain_prob ?? 0}%${deliv}`)
  }
  return lines.join("\n")
}

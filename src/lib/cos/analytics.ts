import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { openDays, slotModel, suggestSlots, type Format, type PerfPost, type SlotModel, type Sugerencia } from "../../../shared/cos/timing"

export { openDays }

export type MediaRow = {
  id: string
  account_id: string
  brand_id: string
  platform: "instagram" | "facebook"
  format: Format
  caption: string | null
  permalink: string | null
  posted_at: string
  thumb_key: string | null
  post_id: string | null
  metrics: Record<string, number>
}

/** Valor de rendimiento de una publicación: alcance, o vistas si la red no da alcance (Facebook). */
export function perfValue(m: Pick<MediaRow, "metrics">): number {
  return m.metrics.reach || m.metrics.views || 0
}

/** Las historias se miden aparte (su alcance no es comparable con el de un post). */
export async function loadMedia(db: SupabaseClient, opts: { brandId?: string; sinceDays?: number }) {
  const since = new Date(Date.now() - (opts.sinceDays ?? 365) * 86_400_000).toISOString()
  const rows: MediaRow[] = []
  // Paginado: Supabase devuelve de a 1000.
  for (let from = 0; ; from += 1000) {
    let q = db
      .from("cos_media")
      .select("id, account_id, brand_id, platform, format, caption, permalink, posted_at, thumb_key, post_id, metrics")
      .gte("posted_at", since)
      .order("posted_at", { ascending: false })
      .range(from, from + 999)
    if (opts.brandId) q = q.eq("brand_id", opts.brandId)
    const { data, error } = await q
    if (error) throw new Error(`No se pudieron cargar las métricas: ${error.message}`)
    rows.push(...((data ?? []) as MediaRow[]))
    if (!data || data.length < 1000) break
  }
  return rows
}

/** Feriados y puentes (F4) del último año y las próximas 2 semanas: se comportan como domingo. */
export async function loadHolidays(db: SupabaseClient): Promise<Set<string>> {
  const from = new Date(Date.now() - 366 * 86_400_000).toISOString().slice(0, 10)
  const to = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10)
  const { data } = await db.from("cos_special_days").select("day").in("kind", ["feriado", "puente"]).gte("day", from).lte("day", to)
  return new Set((data ?? []).map((d) => d.day as string))
}

/** Modelo de franjas de una cuenta y formato; si ese formato tiene poca historia, usa toda la cuenta. */
export function modelFor(
  media: MediaRow[],
  accountId: string,
  format: Format,
  holidays?: Set<string>,
): { model: SlotModel; scope: "formato" | "cuenta" } {
  const mine = media.filter((m) => m.account_id === accountId && perfValue(m) > 0)
  const toPerf = (xs: MediaRow[]): PerfPost[] => xs.map((m) => ({ postedAt: m.posted_at, format: m.format, reach: perfValue(m) }))
  const sameFormat = mine.filter((m) => m.format === format)
  if (sameFormat.length >= 8) return { model: slotModel(toPerf(sameFormat), 3, holidays), scope: "formato" }
  // Las historias no se mezclan con posts (otra escala), aunque haya pocas.
  const pool = format === "story" ? sameFormat : mine.filter((m) => m.format !== "story")
  return { model: slotModel(toPerf(pool), 3, holidays), scope: "cuenta" }
}

/** Sugerencias de horario por cuenta+formato, para Aprobaciones. */
export async function suggestionsFor(
  db: SupabaseClient,
  wanted: { accountId: string; brandId: string; format: Format }[],
): Promise<Record<string, { slots: Sugerencia[]; scope: "formato" | "cuenta"; n: number }>> {
  const out: Record<string, { slots: Sugerencia[]; scope: "formato" | "cuenta"; n: number }> = {}
  const brands = [...new Set(wanted.map((w) => w.brandId))]
  const holidays = await loadHolidays(db)
  for (const brandId of brands) {
    const media = await loadMedia(db, { brandId, sinceDays: 365 })
    const { data: b } = await db.from("cos_brands").select("rules_json").eq("id", brandId).single()
    const allowedDays = openDays((b?.rules_json as { open_days?: string } | null)?.open_days)
    for (const w of wanted.filter((x) => x.brandId === brandId)) {
      const { model, scope } = modelFor(media, w.accountId, w.format, holidays)
      out[`${w.accountId}:${w.format}`] = { slots: model.n ? suggestSlots(model, { allowedDays, holidays }) : [], scope, n: model.n }
    }
  }
  return out
}

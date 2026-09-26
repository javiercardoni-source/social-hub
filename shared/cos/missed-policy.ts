/**
 * MISSED_POST_POLICY (PLAN §5): qué hacer con un post programado cuando el worker
 * llega tarde (estuvo caído, reinicio, deploy).
 *
 *  - Todavía no es la hora              → "wait"
 *  - Atraso ≤ tolerancia (30 min)       → "publish" (se publica igual)
 *  - Atraso mayor, o política estricta  → "missed" (se reprograma a mano)
 *
 * Nunca se publica "un rato después" algo que Javier pensó para otro momento del día.
 */

export type MissedPolicy = "publish_within_tolerance" | "never_publish_late"
export type MissedDecision = "wait" | "publish" | "missed"

/** Margen para no llamar "atrasado" a lo que el worker tomó con segundos de demora. */
const GRACE_MS = 60_000

export function decideScheduledPost(
  scheduledAt: Date,
  now: Date,
  policy: MissedPolicy,
  toleranceMin: number,
): MissedDecision {
  const lateMs = now.getTime() - scheduledAt.getTime()
  if (lateMs < 0) return "wait"
  if (lateMs <= GRACE_MS) return "publish"
  if (policy === "never_publish_late") return "missed"
  return lateMs <= toleranceMin * 60_000 ? "publish" : "missed"
}

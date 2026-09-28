/**
 * Cuándo se vuelve a medir una publicación (F1). Más seguido cuanto más nueva:
 * <3 días cada 2 h · <30 días a diario · <90 días semanal · más vieja, nunca más.
 * Sin dependencias: lo usan el worker y los tests.
 */
const HOUR = 3600_000

/** ¿Toca medir esta publicación ahora? Más seguido cuanto más nueva (la spec define las edades). */
export function isDue(postedAt: string, metricsAt: string | null, now = Date.now(), format?: string): boolean {
  const age = now - new Date(postedAt).getTime()
  // Una historia vencida ya no tiene métricas en Meta: si ya se midió, no se insiste.
  if (format === "story" && age > 26 * HOUR && metricsAt) return false
  if (!metricsAt) return true
  const since = now - new Date(metricsAt).getTime()
  if (age < 3 * 24 * HOUR) return since >= 2 * HOUR - 5 * 60_000
  if (age < 30 * 24 * HOUR) return since >= 24 * HOUR
  if (age < 90 * 24 * HOUR) return since >= 7 * 24 * HOUR
  return false
}


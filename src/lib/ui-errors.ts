import { AVISO_PREFIJO } from "./aviso"

/**
 * Error legible para mostrar en pantalla.
 * - Los avisos de las acciones (`aviso()`) viajan en el digest: se muestran tal cual.
 * - Si se deployó una versión nueva mientras la página estaba abierta, se pide recargar.
 * - Cualquier otro error del servidor llega sin texto en producción: se explica en castellano.
 */
export function explicarError(e: unknown): string {
  const digest = (e as { digest?: unknown } | null)?.digest
  if (typeof digest === "string" && digest.startsWith(AVISO_PREFIJO)) {
    try {
      return decodeURIComponent(digest.slice(AVISO_PREFIJO.length))
    } catch {
      // digest mal formado: sigue con las reglas de abajo
    }
  }
  const msg = e instanceof Error ? e.message : String(e)
  if (/Server Action|older or newer deployment|Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return "Se actualizó Social Hub mientras tenías la página abierta. Recargá la página (Cmd+R) y volvé a intentarlo: no se perdió nada de lo guardado."
  }
  if (/Server Components render|omitted in production/i.test(msg)) {
    const codigo = typeof digest === "string" ? ` (código ${digest})` : ""
    return `Algo falló del lado del servidor${codigo}. Tu texto no se perdió: probá de nuevo en un minuto y, si se repite, pasale este mensaje a Daniela.`
  }
  return msg
}

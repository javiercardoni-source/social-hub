/**
 * Error legible para mostrar en pantalla. Si se deployó una versión nueva mientras la página
 * estaba abierta, el servidor no reconoce el pedido: en vez de un error críptico, se pide recargar.
 */
export function explicarError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/Server Action|older or newer deployment|Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return "Se actualizó Social Hub mientras tenías la página abierta. Recargá la página (Cmd+R) y volvé a intentarlo: no se perdió nada de lo guardado."
  }
  return msg
}

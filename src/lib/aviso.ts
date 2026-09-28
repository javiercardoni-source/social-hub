/**
 * Error para mostrarle a Javier tal cual. En producción Next.js oculta el texto de los errores
 * que se lanzan en una acción del servidor ("An error occurred in the Server Components render"),
 * pero respeta el `digest` si ya viene puesto: ahí viaja el mensaje y `explicarError` lo recupera.
 */
export const AVISO_PREFIJO = "AVISO:"

export function aviso(mensaje: string): Error {
  const e = new Error(mensaje) as Error & { digest?: string }
  e.digest = AVISO_PREFIJO + encodeURIComponent(mensaje.slice(0, 600))
  return e
}

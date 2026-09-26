/**
 * Registro de manejadores por tipo de trabajo. Cada fase agrega los suyos:
 *   Fase 1: ingest:turnos · asset:classify · post:publish · accounts:check · backup:daily
 *   Fase 2A: webhook:meta · comment:reply
 *
 * Un manejador tira PermanentError si reintentar no sirve; cualquier otro error
 * vuelve a la cola con espera creciente (la calcula la base).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Job, Queue } from "./queue.ts"

export type HandlerContext = {
  db: SupabaseClient
  queue: Queue
  log: (msg: string, extra?: Record<string, unknown>) => void
  /** Se activa cuando el worker se está apagando: los trabajos largos deberían cortar. */
  signal: AbortSignal
}

export type Handler = (job: Job, ctx: HandlerContext) => Promise<void>

export const handlers: Record<string, Handler> = {
  // Trabajo de prueba: sirve para verificar punta a punta que la cola anda en producción.
  "system:ping": async (job, ctx) => {
    ctx.log("pong", { job: job.id })
  },
}

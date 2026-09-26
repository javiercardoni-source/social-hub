/**
 * Acceso a la cola cos_jobs (migración 0001). Toda la lógica de concurrencia vive en
 * la base (SKIP LOCKED, leases, dedupe): acá solo se llaman las funciones.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

export type Job = {
  id: number
  type: string
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
  dedupe_key: string | null
}

/** Error que no tiene sentido reintentar (token inválido, archivo borrado, datos rotos). */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PermanentError"
  }
}

export type Queue = ReturnType<typeof createQueue>

export function createQueue(db: SupabaseClient, workerId: string) {
  return {
    async claim(types: string[] | null, limit: number): Promise<Job[]> {
      const { data, error } = await db.rpc("cos_claim_jobs", {
        p_worker: workerId,
        p_types: types,
        p_limit: limit,
      })
      if (error) throw new Error(`cos_claim_jobs: ${error.message}`)
      return (data ?? []) as Job[]
    },

    /** Renueva el lease. false = el trabajo ya no es de este worker (no seguir). */
    async touch(id: number): Promise<boolean> {
      const { data, error } = await db.rpc("cos_touch_job", { p_id: id, p_worker: workerId })
      if (error) throw new Error(`cos_touch_job: ${error.message}`)
      return data === true
    },

    async complete(id: number): Promise<boolean> {
      const { data, error } = await db.rpc("cos_complete_job", { p_id: id, p_worker: workerId })
      if (error) throw new Error(`cos_complete_job: ${error.message}`)
      return data === true
    },

    /** Devuelve 'retry' | 'failed' | 'not_owner'. */
    async fail(id: number, message: string, permanent: boolean): Promise<string> {
      const { data, error } = await db.rpc("cos_fail_job", {
        p_id: id,
        p_worker: workerId,
        p_error: message,
        p_permanent: permanent,
      })
      if (error) throw new Error(`cos_fail_job: ${error.message}`)
      return String(data)
    },

    async enqueue(type: string, payload: Record<string, unknown>, opts: { runAt?: Date; dedupeKey?: string } = {}) {
      const { data, error } = await db.rpc("cos_enqueue_job", {
        p_type: type,
        p_payload: payload,
        p_run_at: (opts.runAt ?? new Date()).toISOString(),
        p_dedupe_key: opts.dedupeKey ?? null,
      })
      if (error) throw new Error(`cos_enqueue_job: ${error.message}`)
      return Number(data)
    },
  }
}

/**
 * Almacenamiento de medios (PLAN §8). Dos implementaciones detrás de la misma interfaz:
 *   · supabase — bucket privado `cos-media` (modo simulación, y miniaturas siempre)
 *   · drive    — la cuenta dedicada por OAuth con drive.file. Se escribe el día de la
 *                conexión, cuando se pueda probar contra Drive de verdad.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { PermanentError } from "./queue.ts"

export const MEDIA_BUCKET = "cos-media"

export type StorageDriver = "supabase" | "drive"

export interface MediaStorage {
  readonly driver: StorageDriver
  download(key: string): Promise<Buffer>
  upload(key: string, data: Buffer, contentType: string): Promise<void>
  /** URL temporal de lectura (Meta la necesita para las fotos: PLAN §9.4). */
  signedUrl(key: string, ttlSeconds: number): Promise<string>
}

export function supabaseStorage(db: SupabaseClient): MediaStorage {
  const bucket = () => db.storage.from(MEDIA_BUCKET)
  return {
    driver: "supabase",
    async download(key) {
      const { data, error } = await bucket().download(key)
      if (error || !data) throw new Error(`no pude bajar ${key}: ${error?.message ?? "vacío"}`)
      return Buffer.from(await data.arrayBuffer())
    },
    async upload(key, data, contentType) {
      const { error } = await bucket().upload(key, data, { contentType, upsert: false })
      // Si ya existe (un reintento después de subirlo), está bien: mismo contenido.
      if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`no pude subir ${key}: ${error.message}`)
    },
    async signedUrl(key, ttlSeconds) {
      const { data, error } = await bucket().createSignedUrl(key, ttlSeconds)
      if (error || !data) throw new Error(`no pude firmar ${key}: ${error?.message}`)
      return data.signedUrl
    },
  }
}

export function storageFor(driver: string | null | undefined, db: SupabaseClient): MediaStorage {
  if (!driver || driver === "supabase") return supabaseStorage(db)
  if (driver === "drive") {
    throw new PermanentError("Drive todavía no está conectado (se conecta al final, ver PLAN §8)")
  }
  throw new PermanentError(`almacenamiento desconocido: ${driver}`)
}

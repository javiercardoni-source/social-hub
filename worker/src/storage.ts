/**
 * Almacenamiento de medios (PLAN §8). Dos implementaciones detrás de la misma interfaz:
 *   · supabase — bucket privado `cos-media`: copia de trabajo y miniaturas
 *   · drive    — archivo maestro en la cuenta dedicada (drive.file), ver drive.ts
 *
 * Meta necesita una URL pública para bajar cada archivo: se usa una URL firmada de
 * cos-media que vence en 1 h, generada de nuevo en cada intento (PLAN §9.4).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { PermanentError } from "./queue.ts"
import { driveFromEnv } from "./drive.ts"

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

/** Solo lectura: en Drive la "key" es el id del archivo. Se escribe con drive.ts (archivar). */
function driveStorage(): MediaStorage {
  const drive = driveFromEnv()
  if (!drive) throw new PermanentError("Drive no está configurado en el servidor (GOOGLE_DRIVE_*)")
  return {
    driver: "drive",
    download: (fileId) => drive.download(fileId),
    upload() {
      throw new PermanentError("para guardar en Drive se usa el trabajo asset:archive")
    },
    signedUrl() {
      throw new PermanentError("Drive no da URLs públicas: se pasa por cos-media (staging)")
    },
  }
}

export function storageFor(driver: string | null | undefined, db: SupabaseClient): MediaStorage {
  if (!driver || driver === "supabase") return supabaseStorage(db)
  if (driver === "drive") return driveStorage()
  throw new PermanentError(`almacenamiento desconocido: ${driver}`)
}

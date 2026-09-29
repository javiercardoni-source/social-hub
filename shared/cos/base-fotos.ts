/**
 * Base de fotos (Drive): qué archivos entran en cada tanda. Sin dependencias: lo usan el
 * worker (Node 24) y la app.
 */

/** Formatos que el sistema sabe procesar → extensión con que se guardan. */
export const BASE_MIMES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
}

/** El worker tiene 768 MB: un video más pesado que esto no se puede procesar en memoria. */
export const BASE_MAX_BYTES = 200 * 1024 * 1024

export const TANDAS = [25, 50, 100, 200] as const

/** Qué traer en la tanda. */
export const TIPOS = ["todo", "fotos", "videos"] as const
export type TipoTanda = (typeof TIPOS)[number]
const esDelTipo = (mime: string, tipo: TipoTanda) =>
  tipo === "todo" || (tipo === "fotos" ? mime.startsWith("image/") : mime.startsWith("video/"))

export type ArchivoBase = { id: string; name: string; mimeType: string; size?: string; createdTime?: string; path: string }

export type Tanda = {
  elegidos: ArchivoBase[]
  total: number // fotos y videos procesables en la carpeta
  fotos: number // de ese total, cuántas fotos…
  videos: number // …y cuántos videos
  yaTraidos: number
  quedan: number // procesables del tipo pedido que siguen sin traer después de esta tanda
  pesados: number // videos que no se pueden traer por tamaño
  noSoportados: number // otros archivos (PDF, planillas, RAW…)
  repetidos: number // copias idénticas (mismo contenido) de algo ya traído o de otro archivo de la carpeta
}

/**
 * Elige los próximos `limite` archivos a traer: los más nuevos primero, sin repetir lo ya
 * traído ni lo que ya está en camino (en la cola). Las copias exactas (mismo contenido, en
 * otra carpeta o con otro nombre) entran una sola vez, aunque la original haya venido en
 * otra tanda (`md5Traidos`).
 */
export function elegirTanda(
  archivos: (ArchivoBase & { md5Checksum?: string })[],
  yaTraidos: Set<string>,
  enCamino: Set<string>,
  limite: number,
  tipo: TipoTanda = "todo",
  md5Traidos: Set<string> = new Set(),
): Tanda {
  let noSoportados = 0
  let pesados = 0
  const procesables: (ArchivoBase & { md5Checksum?: string })[] = []
  for (const f of archivos) {
    if (!BASE_MIMES[f.mimeType]) {
      noSoportados++
      continue
    }
    if (Number(f.size ?? 0) > BASE_MAX_BYTES) {
      pesados++
      continue
    }
    procesables.push(f)
  }
  const traidos = procesables.filter((f) => yaTraidos.has(f.id)).length
  // Huellas ya tomadas: lo traído antes y lo que está en camino (su huella viene en los archivos).
  const hashes = new Set(md5Traidos)
  for (const f of procesables) if (f.md5Checksum && (yaTraidos.has(f.id) || enCamino.has(f.id))) hashes.add(f.md5Checksum)
  let repetidos = 0
  const candidatos = procesables
    .filter((f) => !yaTraidos.has(f.id) && !enCamino.has(f.id))
    // Primero los más nuevos; a igual fecha, el nombre sin "copia"/"(1)" gana.
    .sort((a, b) => (b.createdTime ?? "").localeCompare(a.createdTime ?? "") || a.name.length - b.name.length)
    .filter((f) => {
      if (!f.md5Checksum) return true
      if (hashes.has(f.md5Checksum)) {
        repetidos++
        return false
      }
      hashes.add(f.md5Checksum)
      return true
    })
    .filter((f) => esDelTipo(f.mimeType, tipo))
  const elegidos = candidatos.slice(0, Math.max(0, limite))
  return {
    elegidos,
    total: procesables.length,
    fotos: procesables.filter((f) => f.mimeType.startsWith("image/")).length,
    videos: procesables.filter((f) => f.mimeType.startsWith("video/")).length,
    yaTraidos: traidos,
    quedan: candidatos.length - elegidos.length,
    pesados,
    noSoportados,
    repetidos,
  }
}

/** Saca el id de carpeta de un link de Drive (o acepta el id pelado). null si no parece válido. */
export function carpetaDeLink(link: string): string | null {
  const t = link.trim()
  const m = t.match(/\/folders\/([A-Za-z0-9_-]{10,})/) ?? t.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
  if (m) return m[1]
  return /^[A-Za-z0-9_-]{10,}$/.test(t) ? t : null
}

/** Los ids de Google Drive no son UUID: letras, números, "-" y "_". */
export function esIdDrive(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(v)
}

/**
 * Insumos de los motores visuales (Marca → Motores): qué se acepta de cada tipo.
 * Sin dependencias: lo usan la app y los tests.
 */

export const KINDS = ["referencia", "fuente_titulo", "fuente_texto", "logo", "musica"] as const
export type KindMotor = (typeof KINDS)[number]

/** Supabase corta las subidas en ~50 MB (aunque el bucket admita más). */
export const MAX_SUBIDA = 48 * 1024 * 1024

const EXTS: Record<KindMotor, string[]> = {
  referencia: ["mp4", "mov", "jpg", "jpeg", "png", "webp"],
  fuente_titulo: ["ttf", "otf", "woff"],
  fuente_texto: ["ttf", "otf", "woff"],
  logo: ["png"],
  musica: ["mp3", "m4a", "wav", "aac"],
}

export const extDe = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase()

/** Firma de los primeros bytes: que el archivo sea de verdad lo que dice su extensión. */
function firmaOk(kind: KindMotor, head: Uint8Array): boolean {
  const ascii = (a: number, b: number) => String.fromCharCode(...head.slice(a, b))
  if (kind === "logo") return ascii(1, 4) === "PNG"
  if (kind === "fuente_titulo" || kind === "fuente_texto") {
    const tag = ascii(0, 4)
    return tag === "OTTO" || tag === "wOFF" || tag === "true" || (head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0)
  }
  return true
}

/** null si está bien; si no, el motivo en castellano. `head` = primeros bytes (validación en el servidor). */
export function validarArchivo(kind: KindMotor, name: string, size: number, head?: Uint8Array): string | null {
  const ext = extDe(name)
  if ((kind === "fuente_titulo" || kind === "fuente_texto") && ext === "woff2") {
    return "WOFF2 no sirve para las plantillas: subí la misma tipografía en TTF, OTF o WOFF."
  }
  if (!EXTS[kind].includes(ext)) return `Formato no aceptado para ${ETIQUETA[kind]}: usá ${EXTS[kind].join(", ").toUpperCase()}.`
  if (size <= 0) return "El archivo está vacío."
  if (size > MAX_SUBIDA) return `Pesa ${Math.round(size / 1048576)} MB: el máximo es 48 MB.${kind === "referencia" ? " Recortá el video a la parte que te gusta." : ""}`
  if (head && !firmaOk(kind, head)) return kind === "logo" ? "Ese archivo no es un PNG de verdad." : "Ese archivo no parece una tipografía válida."
  return null
}

export const ETIQUETA: Record<KindMotor, string> = {
  referencia: "referencias de estilo",
  fuente_titulo: "la tipografía de títulos",
  fuente_texto: "la tipografía de textos",
  logo: "el logo",
  musica: "la biblioteca de sonido",
}

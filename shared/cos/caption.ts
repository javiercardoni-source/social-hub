/**
 * Texto final que se publica: caption y hashtags separados por una línea en blanco.
 * Lo usan el publicador y la reconciliación (que busca el post por texto exacto),
 * así que tienen que armarlo igual siempre.
 */
export function fullCaption(caption: string, hashtags: string): string {
  const c = caption.replace(/\r\n/g, "\n").trim()
  const h = hashtags.replace(/\s+/g, " ").trim()
  if (!h) return c
  if (!c) return h
  return `${c}\n\n${h}`
}

/** Para comparar contra lo que devuelve Meta, que puede tocar espacios y saltos de línea. */
export function sameCaption(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()
  return norm(a) === norm(b)
}

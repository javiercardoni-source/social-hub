/**
 * Referencias de estilo cargadas pegando un link (Marca → Motores). Puro, con tests.
 *
 *   tipoDeLink     capcut | instagram | tiktok | otro (null = no es un link válido)
 *   leerCapcut     de la página pública de una plantilla: el video de muestra y la duración EXACTA de
 *                  cada toma (segment_config), que es más preciso que medir los cortes del video
 *   leerOgVideo    el video de cualquier página que lo publique en og:video (plan B)
 *   cortesDesdeTomas  duraciones → segundos donde cae cada corte
 */

export type TipoLink = "capcut" | "instagram" | "tiktok" | "otro"

export function tipoDeLink(raw: string): TipoLink | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== "https:") return null
  const h = u.hostname.replace(/^www\./, "")
  if (h === "capcut.com" || h.endsWith(".capcut.com")) return "capcut"
  if (h === "instagram.com" || h.endsWith(".instagram.com")) return "instagram"
  if (h === "tiktok.com" || h.endsWith(".tiktok.com")) return "tiktok"
  return "otro"
}

/** Un string tal como viene dentro de un JSON embebido en el HTML (con /, \", etc.). */
function stringJson(html: string, clave: string): string | null {
  const re = new RegExp(`"${clave}":"((?:[^"\\\\]|\\\\.)*)"`)
  const m = re.exec(html)
  if (!m) return null
  try {
    return JSON.parse(`"${m[1]}"`) as string
  } catch {
    return null
  }
}

export type PlantillaCapcut = { videoUrl: string; tomas: number[]; duracion: number | null; portada: string | null }

/** null si la página no trae el video (CapCut cambió la página o pide la app). */
export function leerCapcut(html: string): PlantillaCapcut | null {
  const videoUrl = stringJson(html, "video_url")
  if (!videoUrl || !/^https:\/\//.test(videoUrl)) return null
  let tomas: number[] = []
  const seg = stringJson(html, "segment_config")
  if (seg) {
    try {
      const cfg = JSON.parse(seg) as { target_timerange_list?: { start: number; duration: number }[] }
      tomas = (cfg.target_timerange_list ?? [])
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((t) => Math.round((t.duration / 1e6) * 1000) / 1000)
        .filter((d) => d > 0 && d < 60)
    } catch {
      tomas = []
    }
  }
  const total = tomas.reduce((s, d) => s + d, 0)
  return { videoUrl, tomas, duracion: total > 0 ? Math.round(total * 100) / 100 : null, portada: stringJson(html, "cover_url") }
}

export function leerOgVideo(html: string): string | null {
  const m = /<meta[^>]+property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i.exec(html) ?? /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video/i.exec(html)
  const url = m?.[1]?.replace(/&amp;/g, "&") ?? null
  return url && /^https:\/\//.test(url) ? url : null
}

/** [0.67, 0.79, 0.78] → cortes en [0.67, 1.46] (el último no es un corte: es el final). */
export function cortesDesdeTomas(tomas: number[]): number[] {
  const out: number[] = []
  let t = 0
  for (const d of tomas.slice(0, -1)) {
    t += d
    out.push(Math.round(t * 1000) / 1000)
  }
  return out
}

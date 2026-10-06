/**
 * Referencias de estilo cargadas pegando un link (Marca → Motores). Puro, con tests.
 *
 *   tipoDeLink     capcut | instagram | tiktok | otro (null = no es un link válido)
 *   leerCapcut     de la página pública de una plantilla: el video de muestra y la duración EXACTA de
 *                  cada toma (segment_config), que es más preciso que medir los cortes del video; si es
 *                  una plantilla de IMAGEN (post), el diseño completo
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

/** Plantilla de video (videoUrl + tomas) o de IMAGEN (sin video: el diseño entero en imagenUrl). */
export type PlantillaCapcut = { videoUrl: string | null; imagenUrl: string | null; tomas: number[]; duracion: number | null; portada: string | null }

/** El número de la plantilla en un link de CapCut (/templates/<id>). */
export function idPlantilla(url: string): string | null {
  return /\/templates\/(\d{8,25})/.exec(url)?.[1] ?? null
}

/**
 * La página trae también plantillas RELACIONADAS (cada una con su video). Con el id, se recorta el
 * objeto de ESTA plantilla: desde el último video_url antes de su "web_id" hasta su segment_config.
 */
function bloqueDe(html: string, id: string): string | null {
  const ancla = html.indexOf(`"web_id":"${id}"`)
  if (ancla < 0) return null
  const ini = html.lastIndexOf('"video_url":"', ancla)
  if (ini < 0 || ancla - ini > 60_000) return null
  const seg = html.indexOf('"segment_config":"', ancla)
  const fin = seg >= 0 && seg - ancla < 60_000 ? html.indexOf('"}', html.indexOf('target_timerange_list', seg)) + 2 : ancla + 2000
  return html.slice(ini, Math.max(fin, ancla + 100))
}

/** null si la página no trae el video (CapCut cambió la página o pide la app). */
export function leerCapcut(htmlCompleto: string, id?: string | null): PlantillaCapcut | null {
  const html = (id && bloqueDe(htmlCompleto, id)) || htmlCompleto
  const v = stringJson(html, "video_url")
  const videoUrl = v && /^https:\/\//.test(v) ? v : null
  if (!videoUrl) {
    // Plantilla de imagen (post, placa): el diseño completo es su portada.
    // La portada está ANTES del video_url vacío en el objeto de la plantilla: se busca hacia atrás desde su web_id.
    const ancla = id ? htmlCompleto.indexOf(`"web_id":"${id}"`) : -1
    const ini = ancla >= 0 ? htmlCompleto.lastIndexOf('"cover_url":"', ancla) : -1
    const img = ini >= 0 && ancla - ini < 60_000 ? stringJson(htmlCompleto.slice(ini, ancla), "cover_url") : null
    return img && /^https:\/\//.test(img) ? { videoUrl: null, imagenUrl: img, tomas: [], duracion: null, portada: img } : null
  }
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
  return { videoUrl, imagenUrl: null, tomas, duracion: total > 0 ? Math.round(total * 100) / 100 : null, portada: stringJson(html, "cover_url") ?? stringJson(htmlCompleto, "cover_url") }
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

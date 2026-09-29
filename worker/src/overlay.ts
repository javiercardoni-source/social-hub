/**
 * Plantillas de marca: dibujan el texto sobre la imagen y el logo, con la tipografía y
 * los colores de cada marca (sacados de sus Instagram el 28-09-2026). Se genera una capa
 * PNG transparente del tamaño exacto de la imagen final y ffmpeg la pega encima.
 *
 *   banda     franja abajo con la frase + logo (la más "publicitaria")
 *   etiqueta  la frase en un cartel arriba + logo chico abajo
 *   firma     solo el logo chico en una esquina
 *   none      nada
 *
 * Historias: se respetan los márgenes que tapa la interfaz de Instagram (arriba el nombre,
 * abajo la barra de respuesta).
 */
import satori from "satori"
import { Resvg } from "@resvg/resvg-js"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export type Template = "none" | "banda" | "etiqueta" | "firma"

/**
 * Tipografías y logo propios de la marca (Marca → Motores). Reemplazan a los del KIT; lo que
 * no se cargó sigue como estaba. `version` entra en la clave de la pieza: si cambian, se rearma.
 */
export type CustomKit = {
  version: string
  title?: { name: string; data: Buffer }
  text?: { name: string; data: Buffer }
  logo?: { data: Buffer; aspect: number }
}
export type Layout = "top" | "bottom"

/** Posiciones a probar, en orden, para cada plantilla (la IA revisa cada una). */
export function layoutCandidates(template: Template, position: "auto" | Layout): Layout[] {
  if (position !== "auto") return [position]
  return template === "etiqueta" ? ["top", "bottom"] : ["bottom", "top"]
}
export const TEMPLATES: Template[] = ["banda", "etiqueta", "firma", "none"]

const ASSETS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "assets")

type Kit = {
  font: { name: string; file: string; weight: 400 | 700 }
  small: { name: string; file: string; weight: 400 | 600 | 700 | 800 }
  uppercase: boolean
  spacing: number // em
  text: string
  band: string
  label: { bg: string; text: string }
  logo?: { file: string; round: boolean; aspect: number } // aspect = ancho/alto
  wordmark?: string
  defaultTemplate: Template
}

export const KITS: Record<string, Kit> = {
  // Retro, dibujo, fondo carbón; mostaza + bermellón + sakura.
  fasutofudo: {
    font: { name: "Lilita One", file: "lilita-one-latin-400-normal.woff", weight: 400 },
    small: { name: "Montserrat", file: "montserrat-latin-800-normal.woff", weight: 800 },
    uppercase: false,
    spacing: 0,
    text: "#F4B630",
    band: "rgba(28,25,23,0.92)",
    label: { bg: "#E14B32", text: "#FFF6E8" },
    logo: { file: "fasutofudo/logo.png", round: true, aspect: 1 },
    defaultTemplate: "banda",
  },
  // Premium y minimalista: blanco y negro, letra alta y fina, poco texto.
  bijutsukan: {
    font: { name: "Bebas Neue", file: "bebas-neue-latin-400-normal.woff", weight: 400 },
    small: { name: "Montserrat", file: "montserrat-latin-600-normal.woff", weight: 600 },
    uppercase: true,
    spacing: 0.08,
    text: "#FFFFFF",
    band: "rgba(0,0,0,0.78)",
    label: { bg: "rgba(0,0,0,0.72)", text: "#FFFFFF" },
    logo: { file: "bijutsukan/logo.png", round: false, aspect: 600 / 171 },
    defaultTemplate: "firma",
  },
  // Sistema de sus placas de Canva ("abril 2026", aplicado 29-09-2026): fondo negro, título blanco
  // en condensada gruesa (Oswald Bold), recuadro blanco con texto gris y textos chicos en
  // Montserrat Light. Sin logo oficial todavía → firma con el nombre.
  sensaciones: {
    font: { name: "Oswald", file: "oswald-latin-700-normal.woff", weight: 700 },
    small: { name: "Montserrat Light", file: "montserrat-latin-300-normal.woff", weight: 400 },
    uppercase: true,
    spacing: 0.02,
    text: "#FFFFFF",
    band: "rgba(0,0,0,0.82)",
    label: { bg: "#FFFFFF", text: "#3F3F3F" },
    // Sin logo ni nombre: así son sus placas (Javier, 29-09-2026).
    defaultTemplate: "etiqueta",
  },
}

export function defaultTemplate(slug: string): Template {
  return KITS[slug]?.defaultTemplate ?? "none"
}

// Elementos para satori sin JSX (el worker corre TypeScript sin compilar).
type El = { type: string; props: Record<string, unknown> }
const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): El => ({
  type,
  props: { style: { display: "flex", ...style }, children, ...extra },
})

const fontCache = new Map<string, Buffer>()
async function font(file: string) {
  if (!fontCache.has(file)) fontCache.set(file, await readFile(join(ASSETS, "fonts", file)))
  return fontCache.get(file)!
}
const logoCache = new Map<string, string>()
async function logoData(file: string) {
  if (!logoCache.has(file)) logoCache.set(file, `data:image/png;base64,${(await readFile(join(ASSETS, "brand", file))).toString("base64")}`)
  return logoCache.get(file)!
}

/** El logo, o el nombre escrito; null si la marca va sin firma (Sensaciones). */
async function signature(kit: Kit, size: number, logoSrc?: string): Promise<El | null> {
  if (kit.logo) {
    // Redondo: un círculo de `size`. Alargado (ancho ≥ 2 veces el alto): ancho 1,9×size.
    // Casi cuadrado (ej. mascota + nombre): alto = size, para que no tape media foto.
    const h = kit.logo.round ? size : kit.logo.aspect >= 2 ? (size * 1.9) / kit.logo.aspect : size
    const w = kit.logo.round ? size : h * kit.logo.aspect
    return el("img", { width: w, height: h, borderRadius: kit.logo.round ? size / 2 : 0, boxShadow: "0 4px 18px rgba(0,0,0,0.35)" }, undefined, {
      src: logoSrc ?? (await logoData(kit.logo.file)),
      width: w,
      height: h,
    })
  }
  if (!kit.wordmark) return null
  // Sin logo: el nombre de la marca en su tipografía, sobre una pastilla para que se lea en cualquier foto.
  return el(
    "div",
    {
      fontFamily: kit.small.name,
      fontSize: size * 0.34,
      color: "#FFFFFF",
      padding: `${size * 0.1}px ${size * 0.22}px`,
      borderRadius: size,
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    kit.wordmark ?? "",
  )
}

/** Capa PNG transparente de width×height. null si la plantilla no dibuja nada. */
export async function renderOverlay(opts: {
  brand: string
  template: Template
  text: string
  width: number
  height: number
  story: boolean
  layout?: Layout
  custom?: CustomKit
}): Promise<Buffer | null> {
  const base = KITS[opts.brand]
  if (!base || opts.template === "none") return null
  const c = opts.custom
  const kit: Kit = {
    ...base,
    ...(c?.title ? { font: { name: c.title.name, file: "", weight: 400 as const } } : {}),
    ...(c?.text ? { small: { name: c.text.name, file: "", weight: 400 as const } } : {}),
    ...(c?.logo ? { logo: { file: "", round: false, aspect: c.logo.aspect }, wordmark: undefined } : {}),
  }
  const logoSrc = c?.logo ? `data:image/png;base64,${c.logo.data.toString("base64")}` : undefined
  const { width: W, height: H } = opts
  const top = opts.layout === "top"
  const text = (kit.uppercase ? opts.text.toUpperCase() : opts.text).trim()
  const safeTop = opts.story ? H * 0.14 : W * 0.05
  const safeBottom = opts.story ? H * 0.2 : W * 0.05
  const pad = W * 0.055
  const logoSize = W * (opts.template === "banda" ? 0.16 : 0.13)
  const titleSize = W * (kit.uppercase ? 0.095 : 0.078) * (text.length > 28 ? 0.8 : 1)

  const title = (color: string, size = titleSize) =>
    el(
      "div",
      { fontFamily: kit.font.name, fontSize: size, lineHeight: 1.05, letterSpacing: `${kit.spacing}em`, color, flexShrink: 1 },
      text,
    )

  let body: El
  if (opts.template === "banda" && text) {
    body = el("div", {
      width: W,
      height: H,
      flexDirection: "column",
      justifyContent: top ? "flex-start" : "flex-end",
      ...(top ? { paddingTop: safeTop - W * 0.05 } : { paddingBottom: safeBottom - W * 0.05 }),
    }, [
      // Con logo: frase y logo lado a lado. Con el nombre escrito (más ancho que un logo):
      // el nombre va debajo de la frase, si no le come el lugar y se pisan.
      kit.logo
        ? el("div", { width: W, alignItems: "center", gap: pad * 0.6, padding: `${pad * 0.7}px ${pad}px`, backgroundColor: kit.band }, [
            el("div", { flex: 1 }, [title(kit.text)]),
            await signature(kit, logoSize, logoSrc),
          ])
        : el("div", { width: W, flexDirection: "column", alignItems: "flex-start", gap: pad * 0.35, padding: `${pad * 0.7}px ${pad}px`, backgroundColor: kit.band }, [
            title(kit.text),
            ...[await signature(kit, logoSize * 0.8, logoSrc)].filter((x): x is El => !!x),
          ]),
    ])
  } else if (opts.template === "etiqueta" && text) {
    const label = el("div", { alignSelf: "flex-start", maxWidth: W * 0.82, padding: `${pad * 0.35}px ${pad * 0.55}px`, borderRadius: W * 0.025, backgroundColor: kit.label.bg }, [
      title(kit.label.text, titleSize * 0.85),
    ])
    const sign = el("div", { alignSelf: "flex-end" }, [await signature(kit, logoSize, logoSrc)].filter((x): x is El => !!x))
    body = el("div", { width: W, height: H, flexDirection: "column", justifyContent: "space-between", padding: `${safeTop}px ${pad}px ${safeBottom}px` }, top ? [label, sign] : [sign, label])
  } else {
    // firma (o banda/etiqueta sin texto): solo el logo abajo a la derecha. Sin firma: nada que dibujar.
    const sig = await signature(kit, logoSize, logoSrc)
    if (!sig) return null
    body = el("div", { width: W, height: H, justifyContent: "flex-end", alignItems: top ? "flex-start" : "flex-end", padding: `${safeTop}px ${pad}px ${safeBottom}px` }, [sig])
  }

  const fonts = [
    { name: kit.font.name, data: c?.title?.data ?? (await font(kit.font.file)), weight: kit.font.weight, style: "normal" as const },
    { name: kit.small.name, data: c?.text?.data ?? (await font(kit.small.file)), weight: kit.small.weight, style: "normal" as const },
  ]
  const svg = await satori(body as never, { width: W, height: H, fonts })
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng())
}

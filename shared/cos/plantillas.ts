/**
 * Plantillas de post propias de cada marca (elegidas por Javier el 06-10-2026 en el mockup).
 * A diferencia de las plantillas viejas (banda/etiqueta/firma, una capa encima de la foto), estas
 * ARMAN la pieza entera: la foto es un elemento más del diseño (enmarcada, torcida, en grilla).
 *
 * Se usan en los posts e historias de foto y en la tapa de los reels. La IA elige cuál y llena
 * sus textos (`campos`); este archivo define qué lleva cada una y limpia lo que escribe la IA.
 * Sin dependencias: lo usan el worker (Node 24) y la app.
 */

/** feed y story son de redes; impresion = piezas para la imprenta (Diseño gráfico). */
export type FormatoDiseno = "feed" | "story" | "impresion"

export type ClaveCampo = (typeof CLAVES_CAMPO)[number]

export const CLAVES_CAMPO = ["kicker", "titulo", "detalle", "manuscrita", "bajada", "esquina", "sticker", "linea", "pie", "palabra", "pregunta", "opcionA", "opcionB"] as const

export type Campo = { clave: ClaveCampo; max: number; ayuda: string; opcional?: boolean }

export type Plantilla = {
  id: string
  marca: string
  formato: FormatoDiseno
  nombre: string
  /** Cuándo usarla (se lo lee la IA para elegir). */
  para: string
  campos: Campo[]
  /** Cantidad de fotos: la del post + otras de la marca (grilla). */
  fotos: 1 | 4
}

export const PLANTILLAS: Plantilla[] = [
  // ── Bijutsukan: museo de arte. Mucho aire, poco texto.
  {
    id: "bj_galeria",
    marca: "bijutsukan",
    formato: "feed",
    nombre: "Galería",
    para: "Una pieza de autor o un plato puntual: la foto colgada como obra, con su cartela de museo.",
    campos: [
      { clave: "titulo", max: 22, ayuda: "nombre del plato o pieza, corto (ej. SALMÓN FLAMBEADO)" },
      { clave: "detalle", max: 34, ayuda: "qué lleva, en minúscula y poético (ej. con hilos de batata y maracuyá)" },
    ],
    fotos: 1,
  },
  {
    id: "bj_editorial",
    marca: "bijutsukan",
    formato: "feed",
    nombre: "Editorial",
    para: "Novedades de carta, temporada o un mensaje de marca: título grande arriba, foto abajo.",
    campos: [
      { clave: "kicker", max: 26, ayuda: "antetítulo chico (ej. BIJUTSUKAN · PRIMAVERA)" },
      { clave: "titulo", max: 22, ayuda: "título de 2 a 4 palabras (ej. LA CARTA DE AUTOR)" },
      { clave: "manuscrita", max: 10, ayuda: "UNA palabra en manuscrita que cruza la foto (ej. nueva)" },
    ],
    fotos: 1,
  },
  {
    id: "bj_firma",
    marca: "bijutsukan",
    formato: "feed",
    nombre: "Firma",
    para: "Cuando la foto ya lo dice todo: sin texto, solo el nombre de la marca chico abajo.",
    campos: [],
    fotos: 1,
  },
  {
    id: "bj_galeria_v",
    marca: "bijutsukan",
    formato: "story",
    nombre: "Galería vertical",
    para: "Historias: la foto como obra, con cartela y el pedido.",
    campos: [
      { clave: "titulo", max: 22, ayuda: "nombre del plato o pieza, corto" },
      { clave: "detalle", max: 34, ayuda: "qué lleva, en minúscula y poético" },
    ],
    fotos: 1,
  },
  // ── Sensaciones: cálida y de restaurante.
  {
    id: "sn_puro",
    marca: "sensaciones",
    formato: "feed",
    nombre: "Puro",
    para: "Combos, promos y platos para compartir: título grande sobre la foto y el pedido en una píldora.",
    campos: [
      { clave: "kicker", max: 20, ayuda: "antetítulo en mayúsculas (ej. TODO SALMÓN)" },
      { clave: "titulo", max: 16, ayuda: "1 o 2 palabras grandes (ej. Puro Salmón)" },
      { clave: "bajada", max: 40, ayuda: "una línea que explica (ej. 40 piezas para compartir en casa)" },
      { clave: "esquina", max: 18, ayuda: "dato corto abajo a la derecha, SOLO si es cierto (ej. Envío a domicilio)", opcional: true },
    ],
    fotos: 1,
  },
  {
    id: "sn_cartel",
    marca: "sensaciones",
    formato: "feed",
    nombre: "Cartel",
    para: "Recordatorios y avisos del día: foto entera y un cartel terracota en una esquina.",
    campos: [{ clave: "titulo", max: 28, ayuda: "frase corta e invitante (ej. Esta noche, sushi en casa)" }],
    fotos: 1,
  },
  // ── FasutoFudo: pop japonés.
  {
    id: "ff_arma5",
    marca: "fasutofudo",
    formato: "feed",
    nombre: "Armá tus 5",
    para: "El combo de la marca o una invitación a pedir: foto en una tarjeta torcida sobre el color pleno.",
    campos: [
      { clave: "titulo", max: 14, ayuda: "2 o 3 palabras gritadas (ej. ARMÁ TUS 5)" },
      { clave: "linea", max: 36, ayuda: "nombres de rolls separados por · (solo de los que existen)" },
    ],
    fotos: 1,
  },
  {
    id: "ff_sticker",
    marca: "fasutofudo",
    formato: "feed",
    nombre: "Sticker",
    para: "Un producto nuevo o destacado: foto entera, sticker rosa y el nombre bien grande.",
    campos: [
      { clave: "sticker", max: 8, ayuda: "1 o 2 palabras del sticker (ej. ¡NUEVO!, TOP 1)" },
      { clave: "titulo", max: 14, ayuda: "nombre del producto (ej. ONI TATAKI)" },
      { clave: "bajada", max: 28, ayuda: "qué es, en una línea (ej. ROLL DE ATÚN SPICY)" },
    ],
    fotos: 1,
  },
  {
    id: "ff_grilla",
    marca: "fasutofudo",
    formato: "feed",
    nombre: "Grilla",
    para: "Mostrar variedad o pedir que voten: cuatro fotos numeradas.",
    campos: [
      { clave: "titulo", max: 18, ayuda: "pregunta o título (ej. ¿CUÁL ES TU FAV?)" },
      { clave: "pie", max: 26, ayuda: "pedido de interacción (ej. COMENTÁ EL NÚMERO)" },
    ],
    fotos: 4,
  },
  {
    id: "ff_palabra",
    marca: "fasutofudo",
    formato: "feed",
    nombre: "Palabra",
    para: "Un golpe visual: marco torcido y UNA palabra gigante (como el reel de palabra por corte).",
    campos: [{ clave: "palabra", max: 9, ayuda: "UNA palabra corta y sonora (ej. CRUNCH, ÑAM, FUEGO)" }],
    fotos: 1,
  },
  {
    id: "ff_encuesta",
    marca: "fasutofudo",
    formato: "story",
    nombre: "Encuesta",
    para: "Historias: foto en tarjeta y dos opciones para votar.",
    campos: [
      { clave: "pregunta", max: 18, ayuda: "pregunta corta (ej. ¿SALMÓN O SPICY?)" },
      { clave: "opcionA", max: 12, ayuda: "primera opción, 1 o 2 palabras" },
      { clave: "opcionB", max: 12, ayuda: "segunda opción, 1 o 2 palabras" },
    ],
    fotos: 1,
  },
]

/**
 * Plantillas de imprenta (Diseño gráfico): sirven para cualquier marca (marca "*") y se dibujan con
 * su paleta y sus tipografías. Además de estas, en imprenta se pueden usar las de feed de la marca.
 */
export const PLANTILLAS_IMPRESION: Plantilla[] = [
  {
    id: "imp_pedido",
    marca: "*",
    formato: "impresion",
    nombre: "Pedido por WhatsApp",
    para: "Imanes y etiquetas: foto, la marca, el WhatsApp bien grande y un QR que abre el chat.",
    campos: [
      { clave: "titulo", max: 30, ayuda: "frase corta arriba del número (ej. Sushi a domicilio)", opcional: true },
      { clave: "linea", max: 22, ayuda: "el número de WhatsApp tal cual se marca" },
      { clave: "pie", max: 60, ayuda: "días y horario", opcional: true },
    ],
    fotos: 1,
  },
]

/** El pedido que va al pie de la pieza (fijo por marca: la IA no lo cambia). */
export const CTA_MARCA: Record<string, string> = {
  bijutsukan: "PEDÍ POR MENSAJE",
  sensaciones: "PEDÍ POR WHATSAPP",
  fasutofudo: "PEDÍ POR WHATSAPP",
}

export type Diseno = {
  plantilla: string
  campos: Partial<Record<ClaveCampo, string>>
  /** Versiones de otras fotos de la marca (grilla). */
  fotos?: string[]
  /** Número de la cartela (Bijutsukan): lo pone el worker, no la IA. */
  numero?: number
}

export function plantilla(id: string): Plantilla | null {
  return PLANTILLAS.find((p) => p.id === id) ?? PLANTILLAS_IMPRESION.find((p) => p.id === id) ?? null
}

/** Plantillas que se pueden usar en una pieza de imprenta de la marca: las de imprenta + sus de feed. */
export function plantillasImpresion(marca: string, habilitadas: string[]): Plantilla[] {
  return [...PLANTILLAS_IMPRESION, ...plantillasDe(marca, "feed", habilitadas)]
}

/** Las plantillas habilitadas de una marca para un formato (en el orden del catálogo). */
export function plantillasDe(marca: string, formato: FormatoDiseno, habilitadas: string[]): Plantilla[] {
  return PLANTILLAS.filter((p) => p.marca === marca && p.formato === formato && habilitadas.includes(p.id))
}

// Lo que nunca va en una pieza: precios (regla de Javier) ni promesas sin TACC (ninguna marca).
const PRECIO = /\$\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:pesos|ars)\b/gi
const PROHIBIDO = /\b(?:sin\s+tacc|sin\s+gluten|apto\s+cel[ií]acos?|gluten[\s-]?free)\b/gi

/** Corta en el último espacio antes de `max` (no deja palabras partidas). */
function cortar(s: string, max: number): string {
  if (s.length <= max) return s
  const c = s.slice(0, max + 1)
  const i = c.lastIndexOf(" ")
  return (i > max * 0.5 ? c.slice(0, i) : s.slice(0, max)).trim()
}

/**
 * Deja los textos listos para dibujar: solo los campos de la plantilla, sin precios ni frases
 * prohibidas, sin emojis ni hashtags, y dentro del largo. Un campo obligatorio vacío toma
 * `respaldo` (la frase del post) si entra.
 */
export function normalizarCampos(p: Plantilla, campos: Partial<Record<string, unknown>>, respaldo = ""): Diseno["campos"] {
  const out: Diseno["campos"] = {}
  for (const c of p.campos) {
    let v = typeof campos[c.clave] === "string" ? (campos[c.clave] as string) : ""
    v = v
      .replace(PRECIO, "")
      .replace(PROHIBIDO, "")
      .replace(/[#\p{Extended_Pictographic}️]/gu, "")
      .replace(/\s+/g, " ")
      .replace(/^[\s·,.-]+|[\s·,-]+$/g, "")
      .trim()
    if (c.clave === "palabra" || c.clave === "manuscrita") v = v.split(" ")[0] ?? ""
    if (!v && !c.opcional && c.clave === "titulo") v = respaldo.replace(PRECIO, "").replace(PROHIBIDO, "").trim()
    v = cortar(v, c.max)
    if (v) out[c.clave] = v
  }
  return out
}

/** Diseño válido (plantilla conocida de esa marca) o null: entonces la pieza sale como antes. */
export function leerDiseno(x: unknown, marca: string): Diseno | null {
  if (!x || typeof x !== "object") return null
  const o = x as Record<string, unknown>
  const p = typeof o.plantilla === "string" ? plantilla(o.plantilla) : null
  if (!p || p.marca !== marca) return null
  const campos = normalizarCampos(p, (o.campos ?? {}) as Record<string, unknown>)
  const fotos = Array.isArray(o.fotos) ? o.fotos.filter((f): f is string => typeof f === "string").slice(0, 3) : undefined
  const numero = typeof o.numero === "number" && o.numero > 0 ? Math.floor(o.numero) : undefined
  return { plantilla: p.id, campos, ...(fotos?.length ? { fotos } : {}), ...(numero ? { numero } : {}) }
}

/** Texto plano del diseño (para la revisión visual y para mostrar en el panel). */
export function textoDiseno(d: Diseno): string {
  return Object.values(d.campos).filter(Boolean).join(" · ")
}

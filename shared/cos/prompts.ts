/**
 * Prompts de Content OS (PLAN §11, docs/content-os-spec-v2/AI_PROMPTS.md).
 * Los usan el worker (clasificar fotos y videos) y la app (sugerir textos).
 * Sin dependencias: el worker los corre directo con Node 24.
 */

export type BrandContext = {
  name: string
  slug: string
  toneMd: string
  rules: { forbidden_words?: string[]; open_days?: string; open_hours?: string }
  /** Datos comerciales vigentes ya filtrados para hoy (datosParaIA). "" = no cargados. */
  vigentes?: string
  /**
   * Estilo de las referencias de la marca, POR FORMATO (shared/cos/estilo.ts → resumenEstilo). NO va en el
   * system prompt: cada motor agrega solo el suyo (reel al guion, post a la frase del feed, historia a las historias).
   */
  estilos?: { post?: string; reel?: string; historia?: string }
  /** Lo que el dueño rechazó últimamente y por qué (shared/cos/rechazos.ts → leccionesDeRechazos). */
  lecciones?: string
  /** Ritmo de los reels de la marca, según lo MEDIDO en sus referencias (shared/cos/ritmo.ts). */
  ritmoReel?: "normal" | "rafaga"
  /** Palabra por corte (estilo karaoke): opción de la marca (cos_brands.reel_karaoke). */
  karaoke?: boolean
}

/** Alertas que puede levantar el clasificador. Las dos primeras bloquean la publicación. */
export const RISK_FLAGS = [
  "caras_de_clientes",
  "menores",
  "marca_ajena",
  "higiene",
  "imagen_generada_o_de_banco",
  "baja_calidad",
  "texto_ilegible",
] as const
export type RiskFlag = (typeof RISK_FLAGS)[number]
export const BLOCKING_RISK_FLAGS: readonly RiskFlag[] = ["caras_de_clientes", "menores"]

/**
 * Contexto de la marca: va como system prompt con cache (es igual en cada llamada
 * de la misma marca, así se paga una sola vez cada 5 minutos).
 */
export function brandSystemPrompt(b: BrandContext): string {
  const prohibidas = b.rules.forbidden_words?.length ? b.rules.forbidden_words.join(", ") : "(ninguna cargada)"
  const horario = b.rules.open_days ? `${b.rules.open_days}${b.rules.open_hours ? `, de ${b.rules.open_hours}` : ""}` : "no cargado"
  const vigentes = b.vigentes?.trim()
  return [
    `Trabajás para ${b.name}, una marca de comida con delivery en Buenos Aires (grupo Kitchco).`,
    vigentes ? "" : `Horario real de atención: ${horario}.`,
    vigentes
      ? "DATOS COMERCIALES VIGENTES (cargados por el dueño; son la ÚNICA fuente de precios, combos, promos, horarios, zonas y links):\n" + vigentes
      : "",
    "",
    "Reglas duras (no se negocian):",
    "- No inventes nada. Si no está en la descripción del empleado o no se ve en la imagen, no existe.",
    vigentes
      ? "- Precios, combos, promos, horarios, zonas y links: SOLO los de DATOS COMERCIALES VIGENTES, copiados tal cual, y solo si el post es sobre eso " +
        "(no le pongas el precio de un combo a la foto de otro producto). Nunca uses un precio o una promo de publicaciones anteriores."
      : "- Nunca inventes precios, promociones, descuentos ni horarios distintos al real.",
    `- Palabras prohibidas para esta marca: ${prohibidas}.`,
    "- Distinguí siempre lo que DICE el empleado de lo que SE VE en la imagen.",
    "",
    "Voz y contexto de la marca (sale del knowledge-base):",
    b.toneMd.trim() || "(todavía no cargado: usá un tono argentino, informal y cercano, con emojis moderados)",
    b.lecciones?.trim() ? `\n${b.lecciones.trim()}` : "",
  ].join("\n")
}

export function classifierPrompt(input: {
  description: string
  submittedBy: string | null
  mediaType: "photo" | "video"
  frames: number
  /** Material de archivo de la marca (fotógrafo, campañas, publicaciones anteriores). */
  archivo?: boolean
}): string {
  return [
    input.archivo
      ? "Sos el clasificador editorial de Content OS. Te llega material del ARCHIVO de la marca (sesiones de fotógrafo " +
        "profesional, campañas y publicaciones anteriores), no algo que mandó la cocina hoy."
      : "Sos el clasificador editorial de Content OS. Te llega material que mandó un empleado desde la cocina.",
    "",
    `Descripción del empleado: "${input.description}"`,
    `Lo mandó: ${input.submittedBy ?? "(sin dato)"}`,
    input.mediaType === "video"
      ? `Es un VIDEO: te paso ${input.frames} fotogramas en orden.`
      : "Es una FOTO.",
    "",
    "Devolvé la clasificación. Criterios:",
    "- summary: una línea, qué es.",
    "- products: solo productos que el empleado nombra o que se ven con claridad.",
    "- quality_score 0-100: foco, luz, encuadre, que el producto se vea apetitoso.",
    "- commercial_value 0-100: qué tan útil es para vender.",
    "- people_present: true si aparece cualquier persona (manos con guantes no cuentan).",
    "- risk_flags: caras_de_clientes (cualquier cara que no parezca del equipo), menores,",
    "  marca_ajena (logos de otras empresas), higiene (algo que se vea sucio o fuera de norma),",
    input.archivo
      ? "  imagen_generada_o_de_banco (SOLO si es claramente IA o de stock ajena a la marca: que se vea profesional, con fondo" +
        " de estudio o iluminación cuidada es lo esperable en el archivo y NO cuenta),"
      : "  imagen_generada_o_de_banco (si parece IA o foto de stock y no sacada en la cocina),",
    "  baja_calidad, texto_ilegible.",
    "- missing_context: qué le faltó decir al empleado para poder usarla bien (vacío si nada).",
    "- editing_notes: sugerencias concretas de recorte o edición.",
    RASGOS_CRITERIO,
  ].join("\n")
}

// Rasgos visuales del motor de gustos (F7): los mismos criterios en la clasificación completa y
// en la liviana del backfill, para que "cenital" signifique lo mismo en los dos.
const RASGOS_CRITERIO = [
  "- rasgos: cómo está hecha la imagen, eligiendo SIEMPRE de la lista (si dudás, la más cercana).",
  "  En video, mirá el conjunto de fotogramas: el plano y la acción que más se repiten.",
].join("\n")

/** Prompt de la clasificación liviana: solo los rasgos visuales (backfill de F7). */
export function rasgosPrompt(input: { mediaType: "photo" | "video"; frames: number }): string {
  return [
    "Sos el clasificador visual de Content OS (marcas de comida con delivery).",
    input.mediaType === "video" ? `Es un VIDEO: te paso ${input.frames} fotogramas en orden.` : "Es una FOTO (puede ser la portada de un video o carrusel).",
    "Describí solo cómo está hecha la imagen, con el vocabulario de cada campo.",
    RASGOS_CRITERIO,
  ].join("\n")
}

export type CaptionPlatform = "instagram" | "facebook"

export function captionPrompt(input: {
  platform: CaptionPlatform
  postType: "feed" | "carousel" | "reel" | "story"
  descriptions: string[]
  aiSummaries: string[]
  extraInstructions?: string
}): string {
  return [
    `Escribí el texto de una publicación de ${input.platform === "instagram" ? "Instagram" : "Facebook"} (${input.postType}).`,
    "",
    "Material (lo que contó el equipo y lo que vio la IA):",
    ...input.descriptions.map((d, i) => `${i + 1}. Empleado: "${d}"${input.aiSummaries[i] ? ` · Se ve: ${input.aiSummaries[i]}` : ""}`),
    "",
    "Formato:",
    "- hook: la primera línea, la que frena el scroll.",
    input.platform === "instagram"
      ? "- caption: 2 a 4 líneas cortas, con emojis moderados, que cierre con un llamado a pedir (por el canal de los datos vigentes si están; si no, por WhatsApp)."
      : "- caption: 2 a 4 líneas, un poco más explicativo que en Instagram, con llamado a pedir (por el canal de los datos vigentes si están; si no, por WhatsApp).",
    "- hashtags: 3 a 6, en minúscula, empezando por el de la marca.",
    "- rationale: una línea para quien aprueba, explicando por qué este texto (qué dato usaste).",
    "",
    "Si el material no alcanza para decir algo concreto, no lo inventes: hacé un texto más general.",
    input.extraInstructions ? `Pedido extra de quien aprueba: ${input.extraInstructions}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * Instrucciones del guion de un reel (F9, docs/reels/prompts.md §1). Van después de las fuentes
 * (cuadros de cada una). La marca entra por el system (brandSystemPrompt).
 */
export function reelPrompt(input: {
  marca: string
  recuadros: readonly string[]
  temas: string[]
  combos: string[]
  /** Pedido de quien aprueba al rehacer ("más movido", "arrancá con el sushi"…). */
  pedido?: string
  /** Guion anterior al rehacer: el nuevo tiene que ser distinto. */
  anterior?: { gancho: string; idea: string }
  /** Estilo de las referencias de reels de la marca (resumenEstilo). */
  estilo?: string
  /** «rafaga»: muchas tomas cortas, cortes secos al pulso (como las plantillas de CapCut). */
  ritmo?: "normal" | "rafaga"
  /** Palabra por corte: una palabra de una frase de la marca sobre cada toma. */
  karaoke?: boolean
}): string {
  const rafaga = input.ritmo === "rafaga"
  return [
    `Sos editor de reels de ${input.marca}. Armás un REEL vertical 9:16 de 12 a 16 s con estas fuentes.`,
    "",
    rafaga
      ? "RITMO RÁFAGA (el estilo de la marca): 10 a 20 tomas CORTAS, todas con corte seco, al ritmo de la música. Cada una sale de UNA fuente; " +
        "de una misma toma medida de un video podés sacar varias tomas cortas con distinto trim_start (otro momento del mismo plano), y de una foto, varias con movimientos distintos:"
      : "Tomas: 4 a 6. Cada una sale de UNA fuente (una misma foto puede dar varias tomas con movimientos distintos):",
    "- video: trim_start y duracion en segundos, DENTRO de una sola toma medida (no cruces un corte).",
    "- foto: movimiento tipo Ken Burns (trim_start 0).",
    rafaga
      ? "Duración de cada toma: 0.5 a 1.1 s (después se ajusta al pulso exacto del tema). Arrancá con la más impactante y alterná planos para que cada corte muestre algo distinto."
      : "Duración de cada toma: 1.6 a 2.8 s. Arrancá con la más impactante. Alterná planos (general,",
    rafaga ? "" : "detalle, gente disfrutando si hay) y no repitas el mismo momento.",
    'movimiento: "acercar" | "alejar" | "paneo_derecha" | "paneo_izquierda".',
    "foco_x, foco_y (0 a 1): dónde está lo más apetitoso (hacia ahí se acerca la cámara).",
    'transicion de entrada: "corte" | "fundido" (mayoría cortes, al ritmo; fundido para respirar).',
    "por_que: una línea para quien aprueba, explicando por qué elegiste esa toma.",
    "",
    "Textos (MAYÚSCULAS, cortos, en la voz de la marca):",
    "- gancho (2 a 3 palabras): va sobre la primera toma y es la TAPA del reel en el perfil.",
    "- medio (2 a 3 palabras): sobre la tercera toma.",
    "- titulo_cierre (2 a 3 palabras): placa final en negro.",
    `- recuadro: una de ${input.recuadros.join(" | ")} (o vacío).`,
    input.combos.length
      ? `- combo: si la fuente muestra claramente uno de estos combos de DATOS VIGENTES, su nombre exacto: ${input.combos.join(" | ")}. Si no, vacío.`
      : "- combo: vacío (no hay combos cargados).",
    input.temas.length ? `- musica: una de ${input.temas.join(" | ")}.` : "- musica: vacío (la marca no tiene música cargada).",
    "- idea: una línea, qué cuenta el reel.",
    input.karaoke
      ? "- palabras: PALABRA POR CORTE (estilo karaoke). Una frase corta y pegadiza de la marca, partida en palabras, UNA por toma y en el mismo orden " +
        "(misma cantidad que tomas; si sobran tomas, repetí el remate). Que se lea completa con sentido, ej: \"ARMÁ · TUS · 5 · ONIGIRIS · COMO · QUIERAS\". " +
        "Máximo 12 letras por palabra; sin precios ni números de más de 2 cifras. Con palabras, gancho y medio quedan vacíos (la frase cumple ese rol)."
      : "- palabras: lista vacía.",
    "",
    "Reglas de marca (no negociables):",
    '- Nunca inventes escasez ("últimos", "hasta agotar stock", "cupos") ni precios.',
    '- No prometas frescura como dato técnico ("recién hecho", "fresquísimo").',
    '- No prometas tiempos ni rapidez de entrega ("llega volando", "en minutos").',
    "- La bebida (vino, cerveza) nunca es protagonista, aunque aparezca.",
    "- No uses tomas de videos que ya tienen placas de texto viejas o logos de otras marcas.",
    "- Si hay personas, que sea disfrutando.",
    input.estilo?.trim()
      ? `\n${input.estilo.trim()}\nAdaptá a ese estilo el orden de las tomas, su duración (siempre dentro de ${rafaga ? "0.5 a 1.1" : "1.6 a 2.8"} s), los movimientos, ` +
        "las transiciones y cuándo entra el texto. Las reglas de marca de arriba mandan sobre el estilo."
      : "",
    input.pedido?.trim() ? `\nPedido de quien aprueba: ${input.pedido.trim()}` : "",
    input.anterior
      ? `\nEs un REHACER: proponé algo claramente distinto (otras tomas, otro gancho). Anterior → gancho "${input.anterior.gancho}" · idea: ${input.anterior.idea}`
      : "",
  ]
    .filter((l) => l !== "")
    .join("\n")
}

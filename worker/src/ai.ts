/**
 * Clasificación con Claude (PLAN §11): mira la foto o los fotogramas y devuelve un JSON
 * validado. El contexto de la marca va en el system prompt con cache.
 */
import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { RISK_FLAGS, brandSystemPrompt, captionPrompt, classifierPrompt, rasgosPrompt, reelPrompt, type BrandContext, type CaptionPlatform } from "../../shared/cos/prompts.ts"
import { RECUADROS } from "../../shared/cos/reel.ts"
import { RASGOS, costoUsd } from "../../shared/cos/gustos.ts"
import { PermanentError } from "./queue.ts"

/**
 * Rasgos visuales del motor de gustos (F7), con vocabulario CERRADO (shared/cos/gustos.ts).
 * El schema acepta texto (con las opciones en la descripción) y el resultado SIEMPRE pasa por
 * normalizarRasgos(), que descarta lo que no está en la lista: el 30-09 Haiku devolvió un "plano"
 * fuera de la lista pese al enum y la validación estricta hacía fallar la imagen entera (y con
 * ella la clasificación completa). Un rasgo raro queda vacío; no rompe nada. El ritmo y la
 * duración de los videos no los dice la IA: los mide ffmpeg.
 */
const opcion = (campo: keyof typeof RASGOS, que: string) => z.string().describe(`${que}. Exactamente una de: ${RASGOS[campo].join(" | ")}`)
export const RasgosIA = z.object({
  plano: opcion("plano", "primer_plano: el producto llena el cuadro · cenital: desde arriba · medio: producto con algo de contexto · ambiente: el lugar o la escena"),
  protagonista: opcion("protagonista", "Qué es lo principal: producto (el plato) · manos_proceso (manos cocinando o armando) · persona · local · placa (gráfica/texto)"),
  accion: opcion("accion", "Qué pasa: vapor · corte (cuchillo cortando) · armado · salsa (cayendo o sirviéndose) · servido (emplatado/entrega) · nada (quieto)"),
  luz_temp: opcion("luz_temp", "Temperatura de la luz: calida (amarillenta/anaranjada) o fria (blanca/azulada)"),
  luz_nivel: opcion("luz_nivel", "clara (luminosa) u oscura (baja luz, fondo oscuro)"),
  fondo: opcion("fondo", "limpio (liso o sin distracciones) o cargado (muchos objetos o texto)"),
})
export type RasgosIA = z.infer<typeof RasgosIA>

export const Classification = z.object({
  summary: z.string(),
  category: z.string(),
  products: z.array(z.string()),
  topics: z.array(z.string()),
  mood: z.array(z.string()),
  people_present: z.boolean(),
  quality_score: z.number().int().min(0).max(100),
  commercial_value: z.number().int().min(0).max(100),
  suggested_formats: z.array(z.enum(["feed", "carousel", "reel", "story"])),
  risk_flags: z.array(z.enum(RISK_FLAGS)),
  missing_context: z.string(),
  editing_notes: z.array(z.string()),
  rasgos: RasgosIA,
})
export type Classification = z.infer<typeof Classification>

let client: Anthropic | null = null
export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new PermanentError("falta ANTHROPIC_API_KEY: la IA no está configurada")
  client ??= new Anthropic()
  return client
}

export async function classify(opts: {
  db: SupabaseClient
  model: string
  brand: BrandContext
  assetId: string
  description: string
  submittedBy: string | null
  mediaType: "photo" | "video"
  frames: Buffer[]
  /** Material de archivo de la marca (base de fotos, carpetas, Instagram), no de la cocina hoy. */
  archivo?: boolean
}): Promise<Classification> {
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 4000,
    system: [{ type: "text", text: brandSystemPrompt(opts.brand), cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          ...opts.frames.map((f) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: "image/jpeg" as const, data: f.toString("base64") },
          })),
          {
            type: "text",
            text: classifierPrompt({
              description: opts.description,
              submittedBy: opts.submittedBy,
              mediaType: opts.mediaType,
              frames: opts.frames.length,
              archivo: opts.archivo,
            }),
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(Classification) },
  })

  await logUsage(opts.db, { purpose: "asset:classify", model: opts.model, usage: response.usage, assetId: opts.assetId })

  if (!response.parsed_output) throw new Error(`la IA no devolvió una clasificación válida (stop: ${response.stop_reason})`)
  return response.parsed_output
}

export const Caption = z.object({
  overlay: z
    .string()
    .describe(
      "Frase MUY corta para escribir ENCIMA de la imagen: 2 a 6 palabras, sin emojis ni hashtags. " +
        "Tiene que describir o celebrar lo que SE VE o lo que dijo el empleado (ej: 'Tres onigiris, tres estilos'). " +
        "PROHIBIDO afirmar hechos que no estén en la descripción: horarios, 'estamos abiertos', precios, promos, 'nuevo', envíos. " +
        "Única excepción: el nombre o el precio de un combo de DATOS COMERCIALES VIGENTES, tal cual, cuando la foto es claramente ese combo.",
    ),
  overlay_clima: z
    .string()
    .describe(
      "SOLO si te pasaron CLIMA DE HOY: frase MUY corta (2 a 6 palabras) para escribir sobre la HISTORIA que juegue con el clima " +
        "(ej: 'Llueve: plan sushi en casa'). Sin emojis. Si no te pasaron clima, vacío.",
    ),
  usa_clima: z.boolean().describe("true si mencionaste el clima en el texto o en overlay_clima"),
  hook: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  rationale: z.string(),
})
export type Caption = z.infer<typeof Caption>

/** Texto de la publicación en el tono de la marca (PLAN §11). Nunca inventa precios ni promos. */
export async function writeCaption(opts: {
  db: SupabaseClient
  model: string
  brand: BrandContext
  assetId: string
  platform: CaptionPlatform
  postType: "feed" | "carousel" | "reel" | "story"
  description: string
  aiSummary: string
  /** Pedido de quien aprueba al rehacer ("más gracioso", "mencioná el combo"…). */
  request?: string
  /** Versión anterior: al rehacer, la nueva tiene que ser distinta. */
  previous?: { caption: string; overlay: string }
  /** Contexto real de hoy/mañana (fechas especiales, F4). */
  context?: string
  /** Clima de hoy, solo cuando la regla permite usarlo (climaParaHoy). */
  clima?: string | null
}): Promise<Caption> {
  const extra = [
    opts.context
      ? "CONTEXTO REAL de estos días (usalo SOLO si suma naturalmente al post; si no, ignoralo. Nunca inventes fechas ni " +
        "promos, y no prometas nada por el clima: 'llueve, quedate adentro y pedí' está bien; 'llegamos rápido aunque llueva' NO):\n" +
        opts.context
      : "",
    opts.clima
      ? "CLIMA DE HOY (dato real). Usalo SOBRE TODO en overlay_clima (la frase de la historia). En el texto del post, " +
        "solo si suma natural. Nunca prometas nada por el clima ('llegamos aunque llueva' NO):\n" + opts.clima
      : "No hay clima para usar hoy: overlay_clima vacío y no menciones el clima.",
    // Estilo de las referencias del formato: la frase sobre la imagen sigue al de posts o al de historias.
    opts.postType === "story" ? opts.brand.estilos?.historia ?? "" : opts.postType === "reel" ? "" : opts.brand.estilos?.post ?? "",
    opts.request?.trim() ? opts.request.trim() : "",
    opts.previous
      ? `Es un REHACER: proponé algo claramente distinto a la versión anterior (otro enfoque y otras palabras). ` +
        `Anterior → frase: "${opts.previous.overlay}" · texto: "${opts.previous.caption.slice(0, 400)}"`
      : "",
  ]
    .filter(Boolean)
    .join("\n")
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 4000,
    system: [{ type: "text", text: brandSystemPrompt(opts.brand), cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: captionPrompt({
          platform: opts.platform,
          postType: opts.postType,
          descriptions: [opts.description],
          aiSummaries: [opts.aiSummary],
          extraInstructions: extra || undefined,
        }),
      },
    ],
    output_config: { format: zodOutputFormat(Caption) },
  })
  await logUsage(opts.db, { purpose: opts.previous ? "post:redo" : "post:draft", model: opts.model, usage: response.usage, assetId: opts.assetId })
  if (!response.parsed_output) throw new Error(`la IA no devolvió un texto válido (stop: ${response.stop_reason})`)
  return response.parsed_output
}

export const PieceReview = z.object({
  ok: z.boolean().describe("true solo si NADA importante queda tapado y el texto se lee bien"),
  tapa: z.string().describe("Qué tapa (vacío si nada): ej. 'la cara de la mascota', 'el producto', 'el logo que ya trae la foto'"),
  legible: z.boolean(),
  score: z.number().int().min(0).max(100).describe("Calidad de la composición final: 100 = perfecta"),
})
export type PieceReview = z.infer<typeof PieceReview>

/**
 * Control de calidad visual de la pieza final: ¿la banda, el cartel o el logo agregados tapan
 * algo importante de la foto? ¿se lee el texto? Lo usa el armado de piezas para elegir posición.
 */
export async function reviewPiece(opts: { db: SupabaseClient; model: string; image: Buffer; overlayText: string; template: string }): Promise<PieceReview> {
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: opts.image.toString("base64") } },
          {
            type: "text",
            text: [
              "Sos director de arte y revisás una pieza para Instagram ANTES de publicarla.",
              `Sobre la foto original se agregó una plantilla "${opts.template}"${opts.overlayText ? ` con el texto "${opts.overlayText}"` : ""} y el logo de la marca.`,
              "Marcá ok=false si lo agregado (franja, cartel, texto o logo) tapa total o PARCIALMENTE algo importante de la foto:",
              "el producto o la comida, la cara o el cuerpo de una mascota o personaje, caras de personas, un logo o texto que ya venía en la foto.",
              "También ok=false si el texto agregado no se lee bien. Si lo agregado cae sobre fondo, mesa, pared o zona vacía, está bien.",
              "Sé estricto: un recorte de la cara o del producto es un error aunque sea chico.",
            ].join("\n"),
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(PieceReview) },
  })
  await logUsage(opts.db, { purpose: "piece:review", model: opts.model, usage: response.usage })
  if (!response.parsed_output) throw new Error(`la IA no devolvió la revisión (stop: ${response.stop_reason})`)
  return response.parsed_output
}

export async function logUsage(
  db: SupabaseClient,
  x: { purpose: string; model: string; usage: Anthropic.Usage; assetId?: string; postId?: string; costUsd?: number },
) {
  // El costo en dólares queda en null salvo donde hace falta para un tope (traits:backfill).
  const { error } = await db.from("cos_ai_usage").insert({
    cost_usd: x.costUsd ?? null,
    purpose: x.purpose,
    model: x.model,
    input_tokens: x.usage.input_tokens + (x.usage.cache_creation_input_tokens ?? 0),
    output_tokens: x.usage.output_tokens,
    cache_read_tokens: x.usage.cache_read_input_tokens ?? 0,
    asset_id: x.assetId ?? null,
    post_id: x.postId ?? null,
  })
  if (error) console.error("no pude registrar el consumo de IA:", error.message)
}

export const FichaEstilo = z.object({
  resumen: z.string().describe("Una o dos líneas: qué es y qué la hace reconocible"),
  ritmo: z.string().describe("Ritmo de edición en palabras (ej: 'cortes cada 0,8 s, muy rápido, al pulso de la música'). Para placas: 'estática'"),
  planos: z.array(z.string()).describe("Tipos de plano que usa (primerísimo primer plano del producto, cenital, plano de manos, etc.)"),
  movimientos: z.array(z.string()).describe("Movimientos de cámara o efectos que se deducen de los cuadros (acercamiento, paneo, cámara en mano, cámara lenta…)"),
  transiciones: z.array(z.string()).describe("Cómo pasa de una toma a otra (corte seco, barrido, zoom, fundido…); vacío si es placa"),
  texto_en_pantalla: z.string().describe("Si usa texto: cuánto, dónde, cuándo aparece, cómo entra"),
  tipografia: z.string().describe("Estilo de letra (ej: 'sans condensada muy gruesa, en mayúsculas, parecida a Anton/Oswald') y cómo se jerarquiza"),
  paleta: z.array(z.string()).describe("Colores dominantes en HEX aproximado"),
  estructura: z.array(z.string()).describe("Pasos de la pieza en orden (ej: '0-1 s: gancho con el producto', '…: precio', 'cierre: logo + llamado')"),
  para_nuestras_piezas: z.array(z.string()).describe("Qué tomar de esta referencia para las piezas de la marca, concreto y aplicable"),
  evitar: z.array(z.string()).describe("Qué NO copiar (por marca ajena, por no encajar con el brandbook, por alterar el producto)"),
})
export type FichaEstilo = z.infer<typeof FichaEstilo>

/**
 * Ficha de estilo de una referencia (video o placa) que cargó Javier en Marca → Motores.
 * Los cortes vienen medidos por ffmpeg; la IA interpreta los cuadros en orden.
 */
export async function analyzeReference(opts: {
  db: SupabaseClient
  model: string
  brand: BrandContext
  frames: { at: number | null; data: Buffer }[]
  duracion: number | null
  cortes: number[] | null
  nota: string | null
  /** Para qué formato es la referencia: cambia en qué se fija la ficha. */
  para?: "post" | "reel" | "historia"
}): Promise<FichaEstilo> {
  const esVideo = opts.duracion != null
  const datos = esVideo
    ? `Es un VIDEO de ${opts.duracion!.toFixed(1)} s. Cortes medidos con ffmpeg: ${opts.cortes!.length} ` +
      `(${opts.cortes!.length ? `en ${opts.cortes!.map((c) => c.toFixed(1)).join(", ")} s; toma promedio ${(opts.duracion! / (opts.cortes!.length + 1)).toFixed(1)} s` : "plano secuencia, sin cortes"}). ` +
      `Te paso ${opts.frames.length} cuadros en orden, cada uno con su segundo.`
    : "Es una PLACA (imagen fija)."
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 4000,
    system: [{ type: "text", text: brandSystemPrompt(opts.brand), cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          ...opts.frames.flatMap((f) => [
            ...(f.at != null ? [{ type: "text" as const, text: `Segundo ${f.at.toFixed(1)}:` }] : []),
            { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: f.data.toString("base64") } },
          ]),
          {
            type: "text",
            text: [
              "Sos director de arte y editor de video. Esta es una REFERENCIA DE ESTILO que el dueño eligió para inspirar las piezas de la marca.",
              datos,
              opts.nota ? `Lo que le gusta de esta referencia: "${opts.nota}"` : "",
              opts.para === "reel"
                ? "Es referencia para REELS: fijate sobre todo en el ritmo de cortes, la duración de cada toma, los planos, los movimientos de cámara, las transiciones, cuándo y cómo entra el texto y la estructura en el tiempo (gancho, desarrollo, cierre)."
                : opts.para === "historia"
                  ? "Es referencia para HISTORIAS de Instagram: fijate en cuánto texto lleva y dónde, el tamaño, el fondo, si usa stickers o encuestas, el llamado a la acción y qué idea única comunica."
                  : opts.para === "post"
                    ? "Es referencia para POSTS de feed: fijate en la composición y el encuadre del producto, la tipografía y su jerarquía, cuánto texto lleva y dónde, los colores y el uso del logo."
                    : "",
              "Armá la ficha de estilo. Reglas: describí lo que se VE (no inventes sonido ni cosas fuera de cuadro); los movimientos " +
                "de cámara deducilos comparando cuadros seguidos y decí 'probable' si no es claro; la tipografía describila por estilo y " +
                "nombrá la tipografía gratuita (Google Fonts) más parecida; nunca propongas alterar el producto de la marca.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(FichaEstilo) },
  })
  await logUsage(opts.db, { purpose: "ref:analyze", model: opts.model, usage: response.usage })
  if (!response.parsed_output) throw new Error(`la IA no devolvió una ficha válida (stop: ${response.stop_reason})`)
  return response.parsed_output
}

export const FraseFeriado = z.object({
  frase: z.string().describe("Frase para escribir sobre la HISTORIA: entre 3 y 9 palabras, sin hashtags ni emojis (salvo ':D' si la consigna lo pide)."),
})

/** Frase de una historia de feriado en la voz de la marca, siguiendo una consigna fija. */
export async function writeHolidayPhrase(opts: { db: SupabaseClient; model: string; brand: BrandContext; consigna: string; feriado: string }): Promise<string> {
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 2000,
    system: [{ type: "text", text: brandSystemPrompt(opts.brand), cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content:
          `Escribí la frase de una historia de Instagram para el feriado "${opts.feriado}".\n` +
          `Consigna: ${opts.consigna}\n` +
          "Reglas: castellano rioplatense y en la voz de la marca; neutral (nada de política, religión ni opiniones sobre la fecha); " +
          "no inventes horarios, promos ni precios; máximo 60 caracteres." +
          (opts.brand.estilos?.historia ? `\n\n${opts.brand.estilos.historia}` : ""),
      },
    ],
    output_config: { format: zodOutputFormat(FraseFeriado) },
  })
  await logUsage(opts.db, { purpose: "feriado:frase", model: opts.model, usage: response.usage })
  // Las plantillas no dibujan emojis: se sacan siempre (el ":D" es texto y queda).
  const frase = response.parsed_output?.frase.replace(/#\S+/g, "").replace(/\p{Extended_Pictographic}/gu, "").replace(/\s{2,}/g, " ").trim()
  if (!frase) throw new Error(`la IA no devolvió la frase (stop: ${response.stop_reason})`)
  return frase.slice(0, 60)
}

const Regla = z.enum(["con_texto", "sin_texto", "libre"])
export const AnalisisGrilla = z.object({
  resumen: z.string().describe("Una o dos líneas: cómo se ve hoy el perfil y qué es lo más importante a mejorar"),
  con_texto: z.array(z.boolean()).describe("Para CADA posición de la grilla, en orden: true si la imagen lleva texto encima (título, precio, frase), false si es foto limpia"),
  observaciones: z.array(z.string()).describe("Qué se ve en la grilla: equilibrio claro/oscuro, repeticiones de producto, exceso de texto, variedad de formatos. Mencioná posiciones (ej: 'posiciones 1 a 3')"),
  estilo_sugerido: z
    .object({ izquierda: Regla, centro: Regla, derecha: Regla, por_que: z.string() })
    .nullable()
    .describe("Regla por columna (izquierda, centro, derecha) que haría ver el perfil más ordenado, o null si no conviene fijar ninguna"),
  cambios_de_orden: z.array(z.string()).describe("Cambios concretos en lo que está por salir (ej: 'pasá la posición 2 después de la 4 para no juntar dos placas con precio'). Vacío si está bien"),
  otras_ideas: z.array(z.string()).describe("Ideas de formato o contenido según las métricas (ej: 'los reels rinden 2x: sumá uno cada 3 posts')"),
})
export type AnalisisGrilla = z.infer<typeof AnalisisGrilla>

/** La IA mira la grilla del perfil (imagen) con los datos de cada posición y las métricas. */
export async function analyzeGrid(opts: {
  db: SupabaseClient
  model: string
  brand: BrandContext
  grilla: Buffer
  posiciones: string[]
  rendimiento: string
  estiloActual: string
}): Promise<AnalisisGrilla> {
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 6000,
    system: [{ type: "text", text: brandSystemPrompt(opts.brand), cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: opts.grilla.toString("base64") } },
          {
            type: "text",
            text: [
              "Sos community manager y director de arte. Esta imagen es la GRILLA DEL PERFIL de Instagram de la marca tal como va a quedar: 3 columnas, se lee por filas de izquierda a derecha; la posición 1 es arriba a la izquierda (lo más nuevo).",
              "Posiciones (en orden):",
              ...opts.posiciones,
              "",
              `Rendimiento real de la cuenta (últimos 90 días): ${opts.rendimiento}`,
              `Estilo de grilla que tiene configurado: ${opts.estiloActual}`,
              "",
              "Analizá el perfil como un todo: equilibrio claro/oscuro, repeticiones (mismo producto o misma composición juntos), cantidad de texto, variedad de formatos. " +
                "Sugerí un estilo por columna solo si mejora el orden visual (ej: centro sin texto y laterales con texto). " +
                "Recordá que el patrón por columnas se sostiene publicando de a 3. Sé concreto y breve; no inventes datos que no estén acá.",
            ].join("\n"),
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(AnalisisGrilla) },
  })
  await logUsage(opts.db, { purpose: "feed:analyze", model: opts.model, usage: response.usage })
  if (!response.parsed_output) throw new Error(`la IA no devolvió el análisis (stop: ${response.stop_reason})`)
  return response.parsed_output
}

/**
 * Solo los rasgos visuales (backfill de F7): modelo liviano, sin el contexto de la marca (los
 * rasgos no dependen de la marca) y una sola imagen. Devuelve el costo para aplicar el tope.
 */
export async function classifyTraits(opts: {
  db: SupabaseClient
  model: string
  frames: Buffer[]
  mediaType: "photo" | "video"
  assetId?: string
}): Promise<{ rasgos: RasgosIA; costUsd: number }> {
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: [
          ...opts.frames.map((f) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: "image/jpeg" as const, data: f.toString("base64") },
          })),
          { type: "text", text: rasgosPrompt({ mediaType: opts.mediaType, frames: opts.frames.length }) },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(RasgosIA) },
  })
  const u = response.usage
  const costUsd = costoUsd(opts.model, {
    input: u.input_tokens + (u.cache_creation_input_tokens ?? 0),
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
  })
  await logUsage(opts.db, { purpose: "traits:backfill", model: opts.model, usage: u, assetId: opts.assetId, costUsd })
  if (!response.parsed_output) throw new Error(`la IA no devolvió rasgos válidos (stop: ${response.stop_reason})`)
  return { rasgos: response.parsed_output, costUsd }
}

/** Salida del guion de un reel (docs/reels/prompts.md §1). Siempre pasa por normalizarGuion(). */
export const GuionIA = z.object({
  tomas: z.array(
    z.object({
      fuente: z.number().int(),
      trim_start: z.number(),
      duracion: z.number(),
      movimiento: z.string().describe("acercar | alejar | paneo_derecha | paneo_izquierda"),
      foco_x: z.number(),
      foco_y: z.number(),
      transicion: z.string().describe("corte | fundido"),
      por_que: z.string(),
    }),
  ),
  gancho: z.string(),
  medio: z.string(),
  titulo_cierre: z.string(),
  recuadro: z.string(),
  combo: z.string(),
  musica: z.string(),
  idea: z.string(),
})
export type GuionIA = z.infer<typeof GuionIA>

export type BloqueFuente = { tipo: "texto"; texto: string } | { tipo: "imagen"; jpg: Buffer }

/**
 * Guion de un reel: la IA mira las fuentes (cuadros de cada toma medida) y propone tomas,
 * textos y música. max_tokens alto: con 4000 una vez volvió vacío por gastar todo pensando.
 */
export async function planReel(opts: {
  db: SupabaseClient
  model: string
  brand: BrandContext
  bloques: BloqueFuente[]
  temas: string[]
  combos: string[]
  pedido?: string
  anterior?: { gancho: string; idea: string }
  assetId?: string
  postId?: string
}): Promise<GuionIA> {
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 12000,
    system: [{ type: "text", text: brandSystemPrompt(opts.brand), cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          ...opts.bloques.map((b) =>
            b.tipo === "texto"
              ? { type: "text" as const, text: b.texto }
              : { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: b.jpg.toString("base64") } },
          ),
          { type: "text", text: reelPrompt({ marca: opts.brand.name, recuadros: RECUADROS, temas: opts.temas, combos: opts.combos, pedido: opts.pedido, anterior: opts.anterior, estilo: opts.brand.estilos?.reel }) },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(GuionIA) },
  })
  await logUsage(opts.db, { purpose: "reel:plan", model: opts.model, usage: response.usage, assetId: opts.assetId, postId: opts.postId })
  if (!response.parsed_output) throw new Error(`la IA no devolvió un guion válido (stop: ${response.stop_reason})`)
  return response.parsed_output
}

// ── F8 · Agenda ─────────────────────────────────────────────────────────────

/** Frase corta de una historia de clima (consignas en worker/src/agenda.ts). */
export async function writeClimaPhrase(opts: { db: SupabaseClient; model: string; brand: BrandContext; consigna: string }): Promise<string> {
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 2000,
    system: [{ type: "text", text: brandSystemPrompt(opts.brand), cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content:
          "Escribí la frase de una historia de Instagram sobre el clima de hoy.\n" +
          `Consigna: ${opts.consigna}\n` +
          "Reglas: castellano rioplatense y en la voz de la marca; nunca prometas tiempos de entrega ni rapidez; " +
          "no inventes horarios, promos ni precios; máximo 60 caracteres." +
          (opts.brand.estilos?.historia ? `\n\n${opts.brand.estilos.historia}` : ""),
      },
    ],
    output_config: { format: zodOutputFormat(FraseFeriado) },
  })
  await logUsage(opts.db, { purpose: "clima:frase", model: opts.model, usage: response.usage })
  const frase = response.parsed_output?.frase.replace(/#\S+/g, "").replace(/\p{Extended_Pictographic}/gu, "").replace(/\s{2,}/g, " ").trim()
  if (!frase) throw new Error(`la IA no devolvió la frase (stop: ${response.stop_reason})`)
  return frase.slice(0, 60)
}

export const PlanSemana = z.object({
  nota: z.string().describe("Tres a cinco líneas para Javier: cómo viene la semana (clima, feriados, fechas) y qué ajustaste y por qué"),
  cambios: z
    .array(
      z.object({
        post_id: z.string(),
        at: z.string().describe("Nueva fecha y hora en ISO con zona de Buenos Aires, ej. 2026-10-08T19:30:00-03:00"),
        porque: z.string().describe("Una línea: por qué este horario es mejor (dato concreto)"),
      }),
    )
    .describe("Solo los cambios que valen la pena. Vacío si el plan del motor ya está bien."),
})

/**
 * El agente de la agenda: mira el plan del motor con el contexto de la semana y propone ajustes.
 * Propone, no decide: el código valida cada cambio con las mismas reglas del motor.
 */
export async function planearSemana(opts: {
  db: SupabaseClient
  model: string
  brand: BrandContext
  plan: { post_id: string; formato: string; at: string; porque: string; fijo: boolean }[]
  efectos: { factor: string; efecto: number; n: number; confianza: string }[]
  clima: { dia: string; tarde: string | null; noche: string | null }[]
  fechas: { dia: string; nombre: string; tipo: string }[]
  apertura: unknown
  /** Qué hacer esta semana según el motor de gustos (F7 M3): la agenda decide cuándo. */
  sugerencias?: string[]
}): Promise<z.infer<typeof PlanSemana>> {
  const texto = [
    `Sos el estratega de la agenda de publicaciones de ${opts.brand.name}. El motor ya ubicó cada pieza en el mejor horario según las métricas.`,
    "Tu trabajo: revisar el plan con el contexto de la semana y proponer SOLO ajustes que tengan un motivo concreto",
    "(una fecha especial, lluvia justo antes de la cena, dos piezas parecidas muy juntas, un feriado). No inventes datos.",
    "Reglas que el código va a verificar (si no las cumplís, el cambio se descarta): de 9 a 22 h, solo días que abre la marca,",
    "máximo 1 post (feed/reel/carrusel) por día por cuenta y 4 h entre sí, historias con 90 min entre sí y hasta 5 por día,",
    "las piezas con día fijo no cambian de día, nada a menos de 2 h de ahora.",
    "",
    `Ahora: ${new Date().toISOString()}`,
    `Plan del motor:\n${opts.plan.map((p) => `- ${p.post_id} · ${p.formato}${p.fijo ? " (día fijo)" : ""} · ${p.at} · ${p.porque}`).join("\n")}`,
    `Lo que aprendió de las métricas (solo efectos claros): ${opts.efectos.length ? opts.efectos.map((e) => `${e.factor} ×${e.efecto} (n=${e.n}, ${e.confianza})`).join("; ") : "ninguno claro todavía"}`,
    `Clima de los próximos días (tarde / noche): ${opts.clima.map((c) => `${c.dia}: ${c.tarde ?? "?"} / ${c.noche ?? "?"}`).join("; ")}`,
    `Fechas: ${opts.fechas.length ? opts.fechas.map((f) => `${f.dia} ${f.nombre} (${f.tipo})`).join("; ") : "ninguna"}`,
    `Horarios de apertura: ${opts.apertura ? JSON.stringify(opts.apertura) : "sin confirmar"}`,
    opts.sugerencias?.length ? `Lo que el motor de gustos sugiere hacer esta semana (mencionalo en la nota si ayuda a ubicar las piezas): ${opts.sugerencias.join("; ")}` : "",
  ].join("\n")
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 6000,
    system: [{ type: "text", text: brandSystemPrompt(opts.brand), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: texto }],
    output_config: { format: zodOutputFormat(PlanSemana) },
  })
  await logUsage(opts.db, { purpose: "agenda:plan", model: opts.model, usage: response.usage })
  if (!response.parsed_output) throw new Error(`la IA no devolvió el plan (stop: ${response.stop_reason})`)
  return response.parsed_output
}

export const HorariosWeb = z.object({
  dias: z
    .array(
      z.object({
        dia: z.number().int().describe("0 = domingo, 1 = lunes … 6 = sábado"),
        turnos: z.array(z.object({ desde: z.string().describe("HH:MM"), hasta: z.string().describe("HH:MM (24:00 si cierra a medianoche)") })),
      }),
    )
    .describe("Un elemento por cada día que abre, con sus turnos. Los días que no abre no van."),
  dudas: z.string().describe("Si algo no está claro o las fuentes se contradicen, decilo en una línea. Vacío si está todo claro."),
})

/** Horarios de apertura a partir del texto de la web (y lo cargado a mano). Javier los confirma. */
export async function leerHorarios(opts: { db: SupabaseClient; model: string; marca: string; textos: string[] }): Promise<z.infer<typeof HorariosWeb>> {
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 3000,
    messages: [
      {
        role: "user",
        content:
          `Sacá los horarios de atención/pedidos de ${opts.marca} de estas fuentes. Solo lo que esté escrito: no supongas. ` +
          "Si hay horarios de delivery y de local distintos, usá los de pedidos/delivery.\n\n" +
          opts.textos.join("\n\n---\n\n"),
      },
    ],
    output_config: { format: zodOutputFormat(HorariosWeb) },
  })
  await logUsage(opts.db, { purpose: "brand:hours", model: opts.model, usage: response.usage })
  if (!response.parsed_output) throw new Error(`la IA no devolvió horarios (stop: ${response.stop_reason})`)
  return response.parsed_output
}

// ── F7 M3 · Sugerencias de la semana ────────────────────────────────────────

export const SugerenciasSemana = z.object({
  resumen: z.string().describe("Dos o tres líneas: qué le está gustando al público esta semana (solo con los datos que te pasé)"),
  contenido: z
    .array(z.object({ titulo: z.string().describe("Pieza concreta, ej: '2 reels del armado con vapor, de cerca'"), por_que: z.string().describe("El dato que lo respalda, con la cifra tal cual te la pasé") }))
    .describe("3 a 5 piezas concretas para hacer esta semana"),
  material: z.array(z.object({ toma: z.string().describe("Toma para pedirle a la cocina, ej: '10 s del armado de onigiri con vapor, de cerca'"), por_que: z.string() })).describe("Qué filmar/fotografiar (3 a 5)"),
  musica: z.array(z.string()).describe("Qué música bajar o dejar de usar (0 a 3 líneas), solo si los datos lo muestran"),
})

/**
 * Redacta las sugerencias a partir de la tabla de efectos (la IA redacta, no calcula). El que llama
 * valida que no haya cifras inventadas.
 */
export async function escribirSugerencias(opts: { db: SupabaseClient; model: string; brand: BrandContext; datos: string; pedido?: string }): Promise<z.infer<typeof SugerenciasSemana>> {
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 6000,
    system: [{ type: "text", text: brandSystemPrompt(opts.brand), cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content:
          "Sos el estratega de contenido de la marca. Con lo que aprendió el motor de gustos (abajo), proponé qué hacer esta semana. " +
          "Reglas: usá SOLO las cifras que aparecen abajo, tal cual (no calcules ni redondees otras); si un efecto dice 'poca data', no lo uses como argumento; " +
          "respetá la voz y las reglas de la marca; nada de promos ni precios que no estén en Datos vigentes.\n\n" +
          opts.datos +
          (opts.pedido ? `\n\n${opts.pedido}` : ""),
      },
    ],
    output_config: { format: zodOutputFormat(SugerenciasSemana) },
  })
  await logUsage(opts.db, { purpose: "taste:suggest", model: opts.model, usage: response.usage })
  if (!response.parsed_output) throw new Error(`la IA no devolvió sugerencias (stop: ${response.stop_reason})`)
  return response.parsed_output
}

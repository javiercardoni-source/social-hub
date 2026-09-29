/**
 * Clasificación con Claude (PLAN §11): mira la foto o los fotogramas y devuelve un JSON
 * validado. El contexto de la marca va en el system prompt con cache.
 */
import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { RISK_FLAGS, brandSystemPrompt, captionPrompt, classifierPrompt, type BrandContext, type CaptionPlatform } from "../../shared/cos/prompts.ts"
import { PermanentError } from "./queue.ts"

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
})
export type Classification = z.infer<typeof Classification>

let client: Anthropic | null = null
function anthropic(): Anthropic {
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
  x: { purpose: string; model: string; usage: Anthropic.Usage; assetId?: string; postId?: string },
) {
  // El costo en dólares queda en null: los precios se cargan cuando se mida (PLAN §11).
  const { error } = await db.from("cos_ai_usage").insert({
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
          "no inventes horarios, promos ni precios; máximo 60 caracteres.",
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

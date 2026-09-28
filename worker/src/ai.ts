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
        "PROHIBIDO afirmar hechos que no estén en la descripción: horarios, 'estamos abiertos', precios, promos, 'nuevo', envíos.",
    ),
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
}): Promise<Caption> {
  const extra = [
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

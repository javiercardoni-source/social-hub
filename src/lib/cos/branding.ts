import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { BRAND_MODULES, VISUAL_BASELINE, type BrandModuleId } from "../../../shared/cos/brand-modules"

/**
 * Branding Manager: entrevista de marca con el método de la skill brand-discovery.
 * La IA pregunta de a una, repregunta hasta el fondo y, cuando un módulo se satura,
 * lo cierra llamando a la herramienta `cerrar_modulo` con su síntesis.
 */

export type ChatMsg = { role: "assistant" | "user"; content: string; at: string }

export type BrandRow = {
  id: string
  slug: string
  name: string
  tone_md: string | null
  rules_json: Record<string, unknown> | null
  whatsapp_number: string | null
}

let client: Anthropic | null = null
function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY en el servidor")
  client ??= new Anthropic()
  return client
}

const DISCIPLINA = `Reglas de la entrevista (no negociables):
1. UNA sola pregunta por mensaje. Nunca listas de preguntas.
2. Después de cada respuesta: parafraseá en una línea lo que entendiste y hacé UNA repregunta que profundice, o cerrá ese tema si ya está saturado. Nunca pases de tema en silencio.
3. Escalera de valores: ante un "qué", preguntá "¿y por qué eso importa?" hasta llegar a un valor de fondo (2 a 4 veces).
4. Si la respuesta es genérica o vaga ("calidad", "buena atención"), pedí un ejemplo concreto, una historia de un cliente o un número.
5. Una vez por módulo, si la charla se estanca, usá una técnica proyectiva ("si la marca fuera una persona, ¿cómo entraría a un lugar?", "si la marca cerrara en 5 años, ¿qué extrañarían los clientes?", "nombrá una marca que admirás pero que nunca querrías ser").
6. Lo que YA SABEMOS de la marca (abajo) no se pregunta de cero: se muestra y se pide confirmar o corregir, y a partir de ahí se profundiza.
7. Cuando cubriste los temas del módulo y dos repreguntas seguidas no aportan nada nuevo, llamá a la herramienta cerrar_modulo. No la llames antes de tener material real.
8. Escribí en castellano rioplatense, tuteando con "vos", cálido y profesional. Mensajes cortos (máximo 4 líneas antes de la pregunta).`

function moduleInfo(id: BrandModuleId) {
  return BRAND_MODULES.find((m) => m.id === id)!
}

export function brandContext(brand: BrandRow, done: { module: string; summary_md: string | null }[]) {
  const previos = done
    .filter((d) => d.summary_md)
    .map((d) => `### ${moduleInfo(d.module as BrandModuleId)?.label ?? d.module}\n${d.summary_md}`)
    .join("\n\n")
  return [
    `MARCA: ${brand.name} (grupo Kitchco, delivery en Buenos Aires). WhatsApp de pedidos: ${brand.whatsapp_number ?? "sin dato"}.`,
    "",
    "LO QUE YA SABEMOS (ficha actual, sacada del knowledge-base y de sus Instagram):",
    brand.tone_md?.trim() || "(sin ficha cargada)",
    "",
    "LO VISUAL DETECTADO:",
    VISUAL_BASELINE[brand.slug] ?? "(sin análisis visual)",
    previos ? `\nMÓDULOS YA CERRADOS (síntesis):\n${previos}` : "",
  ].join("\n")
}

const CERRAR_MODULO: Anthropic.Tool = {
  name: "cerrar_modulo",
  description:
    "Cerrar el módulo actual cuando sus temas están cubiertos y hay saturación. Guarda la síntesis que después alimenta el brandbook.",
  input_schema: {
    type: "object",
    properties: {
      mensaje_de_cierre: {
        type: "string",
        description: "Mensaje corto para el entrevistado: qué quedó claro en este módulo y qué sigue.",
      },
      sintesis_md: {
        type: "string",
        description:
          "Síntesis en markdown: (1) Hallazgos clave con citas textuales del entrevistado entre comillas; (2) 2 o 3 formulaciones candidatas (ej: 3 versiones del propósito); (3) Decisiones concretas y reglas que salen de acá; (4) Preguntas abiertas o contradicciones.",
      },
    },
    required: ["mensaje_de_cierre", "sintesis_md"],
  },
}

async function model(db: SupabaseClient) {
  const { data } = await db.from("cos_settings").select("ai_model").eq("id", true).single()
  return (data?.ai_model as string) || "claude-sonnet-5"
}

async function logUsage(db: SupabaseClient, purpose: string, m: string, usage: Anthropic.Usage) {
  await db.from("cos_ai_usage").insert({
    purpose,
    model: m,
    input_tokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0),
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
  })
}

/**
 * Un turno del entrevistador. Devuelve el mensaje nuevo y, si cerró el módulo, la síntesis.
 * `forzarCierre` obliga a sintetizar ya (botón "Cerrar este módulo").
 */
export async function interviewTurn(opts: {
  db: SupabaseClient
  brand: BrandRow
  module: BrandModuleId
  messages: ChatMsg[]
  done: { module: string; summary_md: string | null }[]
  forzarCierre?: boolean
}): Promise<{ reply: string; summary: string | null }> {
  const m = moduleInfo(opts.module)
  const system = [
    `Sos el Branding Manager de Kitchco: estratega senior, creador profesional de marcas gastronómicas. Estás entrevistando a Javier, el dueño, para construir el brandbook de ${opts.brand.name}. Ese brandbook después decide cómo se escriben los posts, las frases sobre las imágenes y el diseño de las plantillas, así que buscás respuestas concretas y usables, no frases de manual.`,
    "",
    DISCIPLINA,
    "",
    `MÓDULO ACTUAL: ${m.label} — ${m.goal}`,
    `Marco: ${m.frameworks}`,
    `Temas a cubrir (en el orden que la charla lo pida, de a uno):\n- ${m.topics.join("\n- ")}`,
    "",
    brandContext(opts.brand, opts.done),
  ].join("\n")

  // La API exige que la conversación empiece con el usuario, que ningún mensaje venga vacío
  // y que los roles se alternen: se descartan los vacíos y se juntan los seguidos del mismo rol.
  const history: Anthropic.MessageParam[] = [{ role: "user", content: `Empecemos el módulo "${m.label}".` }]
  for (const x of opts.messages) {
    const content = typeof x.content === "string" ? x.content.trim() : ""
    if (!content) continue
    const last = history[history.length - 1]
    if (last.role === x.role) last.content = `${last.content as string}\n\n${content}`
    else history.push({ role: x.role, content })
  }
  if (opts.forzarCierre) {
    const pedido = "Cerremos este módulo acá con lo que tenemos. Hacé la síntesis."
    const last = history[history.length - 1]
    if (last.role === "user") last.content = `${last.content as string}\n\n${pedido}`
    else history.push({ role: "user", content: pedido })
  }
  // Dos turnos seguidos del mismo rol no valen: si el último es del asistente, no hay nada que responder.
  if (history[history.length - 1].role === "assistant") {
    history.push({ role: "user", content: "Seguí." })
  }

  const mdl = await model(opts.db)
  // Al cerrar, la síntesis puede pasar las 9.000 letras: con 4000 tokens se cortaba.
  const res = await anthropic().messages.create({
    model: mdl,
    max_tokens: 16000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: [CERRAR_MODULO],
    tool_choice: opts.forzarCierre ? { type: "tool", name: "cerrar_modulo" } : { type: "auto" },
    messages: history,
  })
  await logUsage(opts.db, "brand:interview", mdl, res.usage)

  const tool = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "cerrar_modulo")
  if (tool) {
    // La IA a veces cierra sin alguno de los dos campos: nunca se guarda una respuesta vacía.
    const input = (tool.input ?? {}) as { sintesis_md?: string; mensaje_de_cierre?: string }
    const summary = input.sintesis_md?.trim() || null
    const reply =
      input.mensaje_de_cierre?.trim() ||
      (summary ? "Listo, cierro este módulo con lo que charlamos. Podés leer la síntesis abajo." : "¿Seguimos?")
    return { reply, summary }
  }
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim()
  return { reply: text || "¿Seguimos?", summary: null }
}

/** Arma el brandbook con las síntesis de los módulos cerrados. */
export async function synthesizeBrandbook(opts: {
  db: SupabaseClient
  brand: BrandRow
  done: { module: string; summary_md: string | null }[]
}): Promise<string> {
  const mdl = await model(opts.db)
  const res = await anthropic().messages.create({
    model: mdl,
    max_tokens: 12000,
    system: `Sos el Branding Manager de Kitchco. Con las síntesis de la entrevista, escribí el BRANDBOOK de ${opts.brand.name}: la fuente de verdad que después usan la IA que escribe los posts y las plantillas de diseño. Castellano rioplatense. Concreto y accionable: reglas que se puedan cumplir, no frases de manual. Si un módulo no se hizo, usá la ficha actual y marcá "(a confirmar)".`,
    messages: [
      {
        role: "user",
        content: `${brandContext(opts.brand, opts.done)}

Escribí el brandbook en markdown con EXACTAMENTE estas secciones:
# Brandbook — ${opts.brand.name}
## 1. Por qué existimos (propósito, valores en acción, lo que nunca seremos)
## 2. Posicionamiento (declaración "Para [cliente] que [situación], ${opts.brand.name} es [categoría] que [valor]. A diferencia de [alternativas], [diferencial].")
## 3. Cliente ideal y momentos de consumo
## 4. Personalidad (arquetipo principal y secundario, 3 adjetivos sí y 3 no)
## 5. Voz y tono (declaración de voz, espectro, palabras que usamos / que nunca, emojis, tono por tipo de contenido, los 3 chequeos de cada texto)
## 6. Identidad visual (paleta con hex, tipografías, logo y mascota, estilo de foto, cuándo y cómo va texto sobre la imagen)
## 7. Reglas de contenido (qué se puede prometer y qué nunca, promos vigentes, horarios/zonas/canales, llamado a la acción, temas prohibidos)
## 8. Pilares de contenido y proporción
## 9. Ejemplos (5 frases buenas para escribir sobre la imagen, 3 malas y por qué, 2 textos de post modelo)`,
      },
    ],
  })
  await logUsage(opts.db, "brand:brandbook", mdl, res.usage)
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim()
}

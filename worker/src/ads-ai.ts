/**
 * F10 · Motor de ADS — lo que hace la IA (docs/PLAN-MOTOR-ADS.md):
 *   revisarPieza     filtro de seguridad: mira cuadros del video (o la imagen) y marca precio
 *                    quemado, «sin TACC / gluten free», promos vencidas o pinta de IA
 *   escribirAnuncio  título, texto y apertura de una propuesta, con la voz de la marca y SOLO
 *                    precios de Datos vigentes (el que llama lo valida con problemasCopy)
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { anthropic, logUsage } from "./ai.ts"
import { brandSystemPrompt, type BrandContext } from "../../shared/cos/prompts.ts"
import type { Revision, TipoPropuesta } from "../../shared/cos/ads.ts"

/** Subir este número vuelve a revisar todas las piezas (si cambia el criterio). */
export const REVISION_VERSION = 3

const RevisionIA = z.object({
  cuadros: z
    .array(
      z.object({
        indice: z.number().describe("Número de la imagen, empezando en 0, en el orden en que te las pasé"),
        precio: z.boolean().describe("true si se ve un PRECIO escrito sobre la imagen ($, 'mil', 'pesos', números de precio)"),
        sin_tacc: z.boolean().describe("true si se ve 'sin TACC', 'gluten free', 'sin gluten', 'apto celíacos' o su sello"),
      }),
    )
    .describe("Una entrada por cada imagen"),
  promo_vencida: z.boolean().describe("true si la pieza anuncia una promo, descuento o fecha que NO está en Datos vigentes"),
  ia_generada: z.boolean().describe("true si la comida o las personas parecen generadas por IA o de banco de imágenes (no producto real)"),
  producto: z.string().describe("Qué producto se ve, en pocas palabras (ej: 'onigiris', 'combo de rolls')"),
  titular: z
    .string()
    .describe("El texto principal escrito sobre la pieza, SIN el precio, sin sellos ('gluten free'), sin fechas, sin promos de temporada y sin temáticas de fechas especiales (San Valentín/amor, Navidad, Día de la Madre, otoño...) y sobre el PRODUCTO, no sobre retiro, envíos, zonas ni horarios (ej: '40 piezas · Todo salmón Large'). Máximo 40 letras. '' si no queda nada útil fuera de eso."),
  motivos: z.array(z.string()).describe("Por qué no se puede pautar tal cual (vacío si está todo bien). Corto y en castellano."),
})

/**
 * Revisa una pieza ya publicada en anuncios. `cuadros` son JPG de momentos del video (o una sola
 * imagen). El resultado dice si se puede pautar tal cual y qué partes del video están limpias.
 */
export async function revisarPieza(opts: {
  db: SupabaseClient
  model: string
  brand: BrandContext
  cuadros: { t: number; jpg: Buffer }[]
  duracion: number | null
}): Promise<Revision> {
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 3000,
    system: [{ type: "text", text: brandSystemPrompt(opts.brand), cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          ...opts.cuadros.flatMap((c, i) => [
            { type: "text" as const, text: `Imagen ${i}${opts.duracion ? ` (segundo ${c.t.toFixed(1)})` : ""}:` },
            { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: c.jpg.toString("base64") } },
          ]),
          {
            type: "text",
            text: [
              opts.duracion ? "Son cuadros de un video que ya corrió como anuncio de la marca." : "Es la imagen de un anuncio que ya corrió para la marca.",
              "Lo queremos volver a pautar. Reglas que no se negocian:",
              "- NINGÚN precio escrito sobre la pieza (el precio va solo en el texto del anuncio).",
              "- Nada de «sin TACC», «gluten free», «sin gluten» ni «apto celíacos»: ninguna marca lo es.",
              "- Nada de promos, descuentos o fechas que no estén en Datos vigentes.",
              "- Producto real: si parece hecho con IA o de banco, marcalo.",
              "Mirá cada imagen por separado: un precio que aparece solo al final del video marca solo esos cuadros.",
            ].join("\n"),
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(RevisionIA) },
  })
  await logUsage(opts.db, { purpose: "ads:review", model: opts.model, usage: response.usage })
  const r = response.parsed_output
  if (!r) throw new Error(`la IA no devolvió la revisión (stop: ${response.stop_reason})`)
  const marca = new Map(r.cuadros.map((c) => [c.indice, c]))
  const cuadros = opts.cuadros.map((c, i) => ({ t: c.t, limpio: !(marca.get(i)?.precio || marca.get(i)?.sin_tacc) }))
  const precio = r.cuadros.some((c) => c.precio)
  const sinTacc = r.cuadros.some((c) => c.sin_tacc)
  const motivos = [...r.motivos]
  if (precio && !motivos.some((m) => /precio/i.test(m))) motivos.unshift("tiene precio sobre la pieza")
  if (sinTacc && !motivos.some((m) => /tacc|gluten|cel/i.test(m))) motivos.unshift("dice «sin TACC / gluten free»")
  return {
    apto: !precio && !sinTacc && !r.promo_vencida && !r.ia_generada,
    motivos,
    precio_quemado: precio,
    sin_tacc: sinTacc,
    promo_vencida: r.promo_vencida,
    ia_generada: r.ia_generada,
    cuadros: opts.duracion ? cuadros : undefined,
    duracion: opts.duracion,
    producto: r.producto,
    titular: r.titular.replace(/\$\s?\d[\d.,]*/g, "").replace(/\s+/g, " ").trim().slice(0, 40),
  }
}

const AnuncioIA = z.object({
  titulo: z.string().describe("Título del anuncio, máximo 40 letras. Puede llevar el precio SOLO si está en Datos vigentes, tal cual."),
  texto: z.string().describe("Texto principal del anuncio, 2 a 4 líneas, con el llamado a escribir por WhatsApp/mensaje."),
  apertura: z.string().describe("Frase de 2 a 4 palabras para la primera toma del video (sin precio, sin emojis), ej: 'Armá tus 5'"),
  producto: z.string().describe("Nombre EXACTO del combo de Datos vigentes del que habla el anuncio ('' si ninguno)"),
})
export type AnuncioIA = z.infer<typeof AnuncioIA>

const CONSIGNA: Record<TipoPropuesta, string> = {
  reusar: "Volvemos a pautar este anuncio ganador TAL CUAL la pieza, con texto nuevo. Mantené lo que funcionó (el producto, la promesa) y actualizalo con lo vigente.",
  reeditar: "Re-editamos el video ganador: otra apertura y la placa final actual. Escribí una apertura que frene el dedo y el texto del anuncio.",
  organico: "Esta publicación orgánica rindió muy por encima de lo habitual y nunca se pautó. Escribí el texto para pautarla como anuncio de mensajes.",
  variante: "Mismo diseño del ganador, pero el texto habla de OTRO combo vigente distinto del original. Elegí el que mejor encaje con la pieza.",
}

export async function escribirAnuncio(opts: {
  db: SupabaseClient
  model: string
  brand: BrandContext
  tipo: TipoPropuesta
  /** Lo que se sabe de la pieza: texto original, producto que se ve, números. */
  pieza: string
  /** Destino del llamado a la acción (ej: WhatsApp). */
  destino: string
  pedido?: string
}): Promise<AnuncioIA> {
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 2000,
    system: [{ type: "text", text: brandSystemPrompt(opts.brand), cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          "Sos el redactor de anuncios de la marca (Meta Ads, objetivo: que escriban por mensaje).",
          CONSIGNA[opts.tipo],
          `El botón del anuncio lleva a: ${opts.destino}.`,
          `Hoy es ${new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)} (Buenos Aires). Nada de temáticas de fechas especiales (San Valentín, Día de la Madre, Navidad, otoño…) salvo que estén en Datos vigentes: si la pieza original era de una fecha especial, escribí para hoy.`,
          "Reglas duras: precios y promos SOLO de Datos vigentes, copiados tal cual (si no hay, sin precio); nada de «sin TACC», «sin gluten» ni «apto celíacos»;",
          "no prometas tiempos de entrega ni cosas que no estén en los datos; castellano rioplatense, con la voz de la marca.",
          "",
          "LA PIEZA:",
          opts.pieza,
          opts.pedido ? `\n${opts.pedido}` : "",
        ].join("\n"),
      },
    ],
    output_config: { format: zodOutputFormat(AnuncioIA) },
  })
  await logUsage(opts.db, { purpose: "ads:copy", model: opts.model, usage: response.usage })
  if (!response.parsed_output) throw new Error(`la IA no devolvió el anuncio (stop: ${response.stop_reason})`)
  return response.parsed_output
}

const VisualesIA = z.object({
  parecen_ia: z
    .array(z.number())
    .describe("Números de TODAS las candidatas que parecen generadas por IA o renders 3D (formas idénticas y perfectas, etiquetas o packaging imposibles, texturas plásticas, manos raras). Ante la duda, incluila."),
  elegidas: z.array(z.number()).describe("Números de las fotos candidatas que muestran el MISMO producto que el anuncio ganador, de mejor a peor (máximo 4). Vacío si ninguna sirve."),
  motivo: z.string().describe("Una línea: por qué esas"),
})

/**
 * Para rearmar un ganador con producto real: entre las fotos y videos ya publicados de la marca,
 * cuáles muestran el mismo producto, sin precio escrito, sin sellos y sin pinta de IA.
 */
export async function elegirVisuales(opts: {
  db: SupabaseClient
  model: string
  ganador: Buffer
  producto: string
  candidatas: Buffer[]
}): Promise<{ elegidas: number[]; motivo: string }> {
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `ANUNCIO GANADOR (producto: ${opts.producto}):` },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: opts.ganador.toString("base64") } },
          ...opts.candidatas.flatMap((c, i) => [
            { type: "text" as const, text: `Candidata ${i}:` },
            { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: c.toString("base64") } },
          ]),
          {
            type: "text",
            text: [
              "Vamos a rehacer el anuncio ganador con el mismo texto pero sobre fotos REALES ya publicadas de la marca.",
              "Elegí las candidatas que muestran el mismo producto (o uno equivalente de la misma marca: ej. otro combo de rolls si el ganador es un combo de rolls).",
              "Descartá las que tengan precio escrito, sellos ('gluten free', 'sin TACC'), texto grande encima o personas en primer plano.",
              "MUY IMPORTANTE: solo producto REAL fotografiado. Varias publicaciones de las marcas se hicieron con IA (Sora, renders): onigiris o rolls idénticos y perfectos, etiquetas impresas imposibles, packaging de juguete. Listalas en parecen_ia y no las elijas.",
            ].join("\n"),
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(VisualesIA) },
  })
  await logUsage(opts.db, { purpose: "ads:visuales", model: opts.model, usage: response.usage })
  if (!response.parsed_output) throw new Error(`la IA no eligió fotos (stop: ${response.stop_reason})`)
  const r = response.parsed_output
  const ia = new Set(r.parecen_ia)
  return { elegidas: [...new Set(r.elegidas.filter((i) => Number.isInteger(i) && i >= 0 && i < opts.candidatas.length && !ia.has(i)))].slice(0, 4), motivo: r.motivo }
}

// ── Sets a pedido (Anuncios → «Crear set», 10-10-2026) ──────────────────────

const VersionesIA = z.object({
  versiones: z
    .array(
      z.object({
        texto: z.string().describe("Lo que va ESCRITO SOBRE la pieza: corto, que se lea en un segundo (máximo 50 letras). Puede tener dos renglones separados con «\\n»."),
        copy: z.string().describe("Texto para acompañar la publicación o el anuncio (2 a 4 renglones, con la voz de la marca y el llamado a pedir)."),
      }),
    )
    .describe("Las versiones pedidas, en orden"),
})

/**
 * Versiones del texto que Javier escribió para la pieza. La 1 es SU texto tal cual (la IA solo le
 * escribe el copy); las demás cambian el ángulo sin inventar datos (cantidades, productos).
 */
export async function versionesSet(opts: {
  db: SupabaseClient
  model: string
  brand: BrandContext
  textos: string
  detalles: string | null
  cantidad: number
  pedido?: string
}): Promise<{ texto: string; copy: string }[]> {
  const response = await anthropic().messages.parse({
    model: opts.model,
    max_tokens: 6000,
    system: [{ type: "text", text: brandSystemPrompt(opts.brand), cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          "Sos el redactor de anuncios de la marca. Javier escribió el texto que va SOBRE la pieza (foto o video del producto real):",
          "",
          opts.textos,
          "",
          opts.detalles ? `Detalles que te da Javier (producto, tono, público, qué destacar):\n${opts.detalles}\n` : "",
          `Devolvé ${opts.cantidad} versiones. La versión 1 lleva el texto de Javier TAL CUAL (podés repartirlo en dos renglones con «\\n»).`,
          opts.cantidad > 1 ? "Las demás: otro ángulo con LOS MISMOS datos (si dice 40 piezas, son 40; no inventes productos, cantidades ni promos). Que cada una se distinga de las otras." : "",
          "Reglas duras para el texto sobre la pieza: sin precios ni montos (el precio va en el copy, y solo si está en Datos vigentes), nada de «sin TACC», «sin gluten» ni «apto celíacos», castellano rioplatense, máximo 50 letras.",
          "El copy: con la voz de la marca, precios y promos SOLO de Datos vigentes copiados tal cual, sin prometer tiempos de entrega.",
          opts.pedido ? `\n${opts.pedido}` : "",
        ].join("\n"),
      },
    ],
    output_config: { format: zodOutputFormat(VersionesIA) },
  })
  await logUsage(opts.db, { purpose: "ads:set-textos", model: opts.model, usage: response.usage })
  if (!response.parsed_output) throw new Error(`la IA no escribió las versiones (stop: ${response.stop_reason})`)
  return response.parsed_output.versiones.map((v) => ({ texto: v.texto.replace(/\\n/g, "\n").trim(), copy: v.copy.trim() }))
}

const MaterialIA = z.object({
  parecen_ia: z
    .array(z.number())
    .describe("Números de TODAS las candidatas que parecen generadas por IA o renders 3D (formas idénticas y perfectas, etiquetas o packaging imposibles, texturas plásticas, manos raras). Ante la duda, incluila."),
  elegidas: z.array(z.number()).describe("Números de las candidatas que muestran el producto pedido, de mejor a peor (máximo 8). Vacío si ninguna sirve."),
  motivo: z.string().describe("Una línea: por qué esas"),
})

/**
 * Entre fotos y videos reales de la marca (miniaturas), cuáles muestran lo que pide el set: el
 * mismo producto, sin precio escrito, sin sellos y sin pinta de IA.
 */
export async function elegirMaterial(opts: {
  db: SupabaseClient
  model: string
  pedido: string
  candidatas: Buffer[]
}): Promise<{ elegidas: number[]; motivo: string }> {
  const response = await anthropic().messages.parse({
    model: opts.model,
    // Hasta 24 candidatas (Instagram + Archivo): con 1500 la respuesta se cortaba (10-10-2026).
    max_tokens: 6000,
    messages: [
      {
        role: "user",
        content: [
          ...opts.candidatas.flatMap((c, i) => [
            { type: "text" as const, text: `Candidata ${i}:` },
            { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: c.toString("base64") } },
          ]),
          {
            type: "text",
            text: [
              "Vamos a armar anuncios con este texto encima, sobre fotos y videos REALES de la marca:",
              opts.pedido,
              "",
              "Elegí las candidatas que muestran ese producto (o el más parecido de la marca). Que se vea la comida: mejor de cerca y apetitosa.",
              "Descartá las que tengan precio escrito, sellos ('gluten free', 'sin TACC'), texto grande encima o personas en primer plano.",
              "MUY IMPORTANTE: solo producto REAL fotografiado. Varias publicaciones de las marcas se hicieron con IA (Sora, renders): listalas en parecen_ia y no las elijas.",
            ].join("\n"),
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(MaterialIA) },
  })
  await logUsage(opts.db, { purpose: "ads:set-material", model: opts.model, usage: response.usage })
  if (!response.parsed_output) throw new Error(`la IA no eligió material (stop: ${response.stop_reason})`)
  const r = response.parsed_output
  const ia = new Set(r.parecen_ia)
  return { elegidas: [...new Set(r.elegidas.filter((i) => Number.isInteger(i) && i >= 0 && i < opts.candidatas.length && !ia.has(i)))].slice(0, 8), motivo: r.motivo }
}

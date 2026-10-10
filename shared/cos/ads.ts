/**
 * F10 · Motor de ADS (docs/PLAN-MOTOR-ADS.md) — la parte pura, con tests. Sin dependencias:
 * la usan el worker (Node 24) y la app.
 *
 *   leerInsights      una fila de insights de Meta → números (conversaciones y su costo de la API)
 *   tipoCreativo      video / imagen / post / carrusel, mirando el creativo
 *   rankearAnuncios   ganadores por marca (costo por conversación con gasto mínimo)
 *   porQueAnuncio     la línea de «por qué» de una propuesta, solo con números reales
 *   tramosLimpios     partes de un video sin precio quemado ni sellos (para re-editar)
 *   guionReedicion    el guion del reel re-editado: otra apertura + placa final sin precio
 *   guionRearmado     el diseño ganador (titular sin precio) sobre fotos reales ya publicadas
 *   problemasCopy     lo que no puede decir un anuncio (sin TACC, precios que no están vigentes)
 *   aprendizaje       E5: qué tipo de propuesta le ganó a su anuncio de origen
 *   elegirTanda       qué propuestas arma la tanda de la semana
 */
import type { GuionReel, Toma } from "./reel.ts"

export type TipoPropuesta = "reusar" | "reeditar" | "organico" | "variante"
export const TIPOS: TipoPropuesta[] = ["reusar", "reeditar", "organico", "variante"]
export const TIPO_TEXTO: Record<TipoPropuesta, string> = {
  reusar: "Ganador con texto nuevo",
  reeditar: "Ganador re-editado",
  organico: "Pautar un orgánico",
  variante: "Variante del mismo diseño",
}

// ── Insights ────────────────────────────────────────────────────────────────

/** La acción que cuenta como conversación (CTWA, Messenger, Instagram Direct). */
export const ACCION_CONVERSACION = "onsite_conversion.messaging_conversation_started_7d"
const ACCION_PRIMERA_RESPUESTA = "onsite_conversion.messaging_first_reply"

type Accion = { action_type: string; value: string }
export type FilaInsights = {
  spend?: string
  impressions?: string
  reach?: string
  clicks?: string
  inline_link_clicks?: string
  actions?: Accion[]
  cost_per_action_type?: Accion[]
}
export type Numeros = {
  spend: number
  impressions: number
  reach: number
  clicks: number
  link_clicks: number
  conversations: number
  first_replies: number
  /** De cost_per_action_type (Meta). null si no hubo conversaciones. Nunca spend/conversaciones. */
  cost_per_conversation: number | null
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""))
  return Number.isFinite(n) ? n : 0
}
const accion = (lista: Accion[] | undefined, tipo: string) => lista?.find((a) => a.action_type === tipo)

export function leerInsights(f: FilaInsights): Numeros {
  const conversations = Math.round(num(accion(f.actions, ACCION_CONVERSACION)?.value))
  const costo = accion(f.cost_per_action_type, ACCION_CONVERSACION)
  return {
    spend: num(f.spend),
    impressions: Math.round(num(f.impressions)),
    reach: Math.round(num(f.reach)),
    clicks: Math.round(num(f.clicks)),
    link_clicks: Math.round(num(f.inline_link_clicks)),
    conversations,
    first_replies: Math.round(num(accion(f.actions, ACCION_PRIMERA_RESPUESTA)?.value)),
    cost_per_conversation: conversations > 0 && costo && num(costo.value) > 0 ? num(costo.value) : null,
  }
}

// ── Creativo ────────────────────────────────────────────────────────────────

export type CreativoMeta = {
  object_type?: string
  video_id?: string
  image_hash?: string
  effective_instagram_media_id?: string
  object_story_spec?: {
    video_data?: { video_id?: string }
    link_data?: { image_hash?: string; picture?: string; child_attachments?: unknown[] }
    photo_data?: { image_hash?: string }
  }
}
export type TipoCreativo = "video" | "imagen" | "post" | "carrusel" | "otro"

export function tipoCreativo(c: CreativoMeta | null | undefined): TipoCreativo {
  if (!c) return "otro"
  const oss = c.object_story_spec
  if (oss?.video_data?.video_id || c.video_id) return "video"
  if (oss?.link_data?.child_attachments?.length) return "carrusel"
  if (oss?.link_data?.image_hash || oss?.photo_data?.image_hash || oss?.link_data?.picture || c.image_hash) return "imagen"
  // Sin object_story_spec propio: es una publicación existente promocionada.
  if (c.effective_instagram_media_id || c.object_type === "SHARE" || c.object_type === "STATUS") return "post"
  return "otro"
}

/** Meta da los presupuestos en centavos de la moneda de la cuenta. */
export const desdeCentavos = (v: unknown) => (v == null || v === "" ? null : num(v) / 100 || null)
export const aCentavos = (pesos: number) => String(Math.round(pesos * 100))

// ── Revisión de seguridad (la IA mira la pieza) ─────────────────────────────

export type Revision = {
  /** La pieza se puede pautar tal cual. */
  apto: boolean
  motivos: string[]
  precio_quemado: boolean
  sin_tacc: boolean
  promo_vencida: boolean
  /** Parece hecha con IA (no es producto real). */
  ia_generada: boolean
  /** Cuadros revisados del video (segundos) y si estaban limpios. */
  cuadros?: { t: number; limpio: boolean }[]
  duracion?: number | null
  /** El texto ganador de la pieza SIN precio, sellos ni promos con fecha ("" si no queda nada). */
  titular?: string
  /** Qué producto se ve (para buscar fotos reales del mismo producto). */
  producto?: string
}

// ── Ranking ─────────────────────────────────────────────────────────────────

export type AnuncioRanking = {
  id: string
  totals: Partial<Numeros>
  revision?: Revision | null
  creative_kind?: string | null
  last_date?: string | null
}
export type Ganador = {
  id: string
  /** Puntaje (más bajo = mejor): costo por conversación suavizado hacia lo habitual de la marca. */
  puntaje: number
  /** Costo por conversación de la API / lo habitual de la marca (0,6 = 40 % más barato). */
  vsMarca: number
  apto: boolean | null
}
export type Ranking = { habitual: number | null; minimoGasto: number; ganadores: Ganador[]; sinDatos: string[] }

function mediana(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Ganadores de una marca. Cuenta solo lo que gastó lo suficiente para que el número diga algo
 * (al menos 5 conversaciones y el doble de lo habitual de la marca por conversación). El puntaje
 * suaviza el costo hacia lo habitual (10 conversaciones «de lo habitual» de más), así un anuncio
 * con 6 mensajes baratos no le gana a uno con 8.000 mensajes casi igual de baratos.
 */
export function rankearAnuncios(ads: AnuncioRanking[], opts: { minimoGasto?: number } = {}): Ranking {
  const conDatos = ads.filter((a) => (a.totals.conversations ?? 0) >= 5 && a.totals.cost_per_conversation != null)
  const habitual = mediana(conDatos.map((a) => a.totals.cost_per_conversation as number))
  const minimoGasto = Math.max(opts.minimoGasto ?? 0, habitual ? habitual * 2 : 0)
  const K = 10
  const ganadores: Ganador[] = []
  const sinDatos: string[] = []
  for (const a of ads) {
    const spend = a.totals.spend ?? 0
    const conv = a.totals.conversations ?? 0
    const cpc = a.totals.cost_per_conversation
    if (!habitual || conv < 5 || cpc == null || spend < minimoGasto) {
      sinDatos.push(a.id)
      continue
    }
    // Costo implícito de la API × conversaciones = lo gastado en conversaciones (no el gasto total).
    const puntaje = (cpc * conv + K * habitual) / (conv + K)
    ganadores.push({ id: a.id, puntaje, vsMarca: cpc / habitual, apto: a.revision ? a.revision.apto : null })
  }
  ganadores.sort((x, y) => x.puntaje - y.puntaje)
  return { habitual, minimoGasto, ganadores, sinDatos }
}

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`

/** «Por qué» de un anuncio ganador: solo números de Meta (y la comparación con lo habitual). */
export function porQueAnuncio(t: Partial<Numeros>, habitual: number | null): string {
  const cpc = t.cost_per_conversation
  if (cpc == null) return ""
  const base = `${pesos(cpc)} por conversación con ${pesos(t.spend ?? 0)} invertidos y ${t.conversations ?? 0} conversaciones`
  if (!habitual) return `${base}.`
  const dif = Math.round((1 - cpc / habitual) * 100)
  if (Math.abs(dif) < 5) return `${base}: en línea con lo habitual de la marca (${pesos(habitual)}).`
  return `${base}: ${Math.abs(dif)} % ${dif > 0 ? "más barato" : "más caro"} que lo habitual de la marca (${pesos(habitual)}).`
}

// ── Re-edición ──────────────────────────────────────────────────────────────

/**
 * Partes del video sin nada prohibido. Cada cuadro revisado representa ±paso/2 a su alrededor;
 * los cuadros limpios seguidos se unen. Devuelve [inicio, fin] en segundos.
 */
export function tramosLimpios(cuadros: { t: number; limpio: boolean }[], duracion: number): [number, number][] {
  const c = [...cuadros].sort((a, b) => a.t - b.t)
  if (!c.length || duracion <= 0) return []
  const paso = c.length > 1 ? (c[c.length - 1].t - c[0].t) / (c.length - 1) : duracion
  const out: [number, number][] = []
  for (const x of c) {
    if (!x.limpio) continue
    const ini = Math.max(0, x.t - paso / 2)
    const fin = Math.min(duracion, x.t + paso / 2)
    const ult = out[out.length - 1]
    if (ult && ini <= ult[1] + 0.01) ult[1] = Math.max(ult[1], fin)
    else out.push([ini, fin])
  }
  // Margen de 0,15 s en cada borde que toca algo sucio (el cuadro sucio puede empezar antes).
  return out
    .map(([a, b]) => [a > 0 ? a + 0.15 : a, b < duracion ? b - 0.15 : b] as [number, number])
    .filter(([a, b]) => b - a >= 1.5)
}

/**
 * Guion del reel re-editado: hasta 4 tomas de los tramos limpios (en orden), con la apertura
 * nueva arriba y la placa final de la marca SIN precio. null = no alcanza el material limpio.
 */
export function guionReedicion(
  tramos: [number, number][],
  p: { gancho: string; tituloCierre: string; recuadro: string; pie: string | null; idea: string },
): GuionReel | null {
  const tomas: Toma[] = []
  // Las tomas más largas primero para elegir, después en orden de aparición.
  const elegidos = [...tramos].sort((a, b) => b[1] - b[0] - (a[1] - a[0])).slice(0, 4).sort((a, b) => a[0] - b[0])
  for (const [a, b] of elegidos) {
    const largo = b - a
    // Tramos largos dan dos tomas (otro encuadre), así el video no queda corto.
    const partes = largo >= 5.2 ? 2 : 1
    for (let i = 0; i < partes && tomas.length < 4; i++) {
      const dur = Math.min(2.8, largo / partes)
      if (dur < 1.5) continue
      tomas.push({
        fuente: 0,
        trim_start: Math.round((a + i * (largo / partes)) * 100) / 100,
        duracion: Math.round(dur * 100) / 100,
        movimiento: tomas.length % 2 ? "alejar" : "acercar",
        foco_x: 0.5,
        foco_y: 0.5,
        transicion: tomas.length === 0 ? "corte" : "fundido",
      })
    }
  }
  if (tomas.length < 2) return null
  return {
    tomas,
    gancho: p.gancho,
    medio: "",
    titulo_cierre: p.tituloCierre,
    recuadro: p.recuadro,
    musica: null,
    combo: "",
    idea: p.idea,
    // Nunca precio en la pieza: el precio va en el texto del anuncio.
    cierre: { precio: null, pie: p.pie },
  }
}

/**
 * Rearmado del diseño ganador sobre fotos y videos reales ya publicados (cuando la pieza original
 * tiene el precio pegado encima del producto y no hay tramo limpio): una toma por fuente (hasta 4),
 * el titular ganador arriba y la placa final sin precio. null = no hay fuentes.
 */
export function guionRearmado(
  fuentes: { tipo: "foto" | "video"; duracion: number | null }[],
  p: { gancho: string; tituloCierre: string; recuadro: string; pie: string | null; idea: string; medio?: string },
): GuionReel | null {
  const MOV: Toma["movimiento"][] = ["acercar", "paneo_derecha", "alejar", "paneo_izquierda"]
  const tomas: Toma[] = fuentes.slice(0, 4).map((f, i) => {
    const dur = f.tipo === "video" ? Math.min(2.8, Math.max(1.5, (f.duracion ?? 3) - 0.3)) : 2.6
    // Un video largo se toma desde un poco después del arranque (los primeros cuadros suelen ser flojos).
    const ini = f.tipo === "video" && (f.duracion ?? 0) > dur + 1.2 ? 0.6 : 0
    return { fuente: i, trim_start: ini, duracion: Math.round(dur * 100) / 100, movimiento: f.tipo === "video" ? (i % 2 ? "alejar" : "acercar") : MOV[i % 4], foco_x: 0.5, foco_y: 0.5, transicion: i === 0 ? "corte" : "fundido" }
  })
  if (!tomas.length) return null
  // Con una sola fuente, dos tomas (otro movimiento) para que no quede de 2 segundos.
  if (tomas.length === 1) tomas.push({ ...tomas[0], movimiento: "alejar", transicion: "fundido" })
  // El texto del medio aparece en la tercera toma: con menos, se repiten tomas con otro movimiento.
  const medio = (p.medio ?? "").trim()
  for (let i = 0; medio && tomas.length < 3; i++) tomas.push({ ...tomas[i], movimiento: MOV[(tomas.length + 1) % 4], transicion: "fundido" })
  return {
    tomas,
    gancho: p.gancho,
    medio,
    titulo_cierre: p.tituloCierre,
    recuadro: p.recuadro,
    musica: null,
    combo: "",
    idea: p.idea,
    cierre: { precio: null, pie: p.pie },
  }
}

/** Clave de diseño de un titular (sin tildes, mayúsculas ni signos): «40 PIEZAS · TODO SALMÓN» = «40 piezas todo salmon». */
export function grupoTitular(t: string | null | undefined): string | undefined {
  const k = (t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  return k || undefined
}

const DE_TEMPORADA = /amor|enamorad|valent|corazon|navidad|navide|fiestas|a[nñ]o nuevo|reyes|pascua|madre|padre|ni[nñ]o|amig[oa]s? dia|oto[nñ]o|invierno|primavera|verano|mundial|black ?friday|cyber/i

// Logística, no producto: no sirve de apertura (y las zonas o el retiro cambian).
const NO_PRODUCTO = /retiro|envio|zona|horario|direcci|abierto|delivery a/i

/**
 * El titular sirve para hoy, o "" si es de una fecha especial o una temporada, o si habla de
 * logística (retiro, envíos, horarios) y no del producto: con eso no se rearma un anuncio.
 */
export function titularVigente(t: string | null | undefined): string {
  const x = (t ?? "").trim()
  const plano = x.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  return !x || DE_TEMPORADA.test(plano) || NO_PRODUCTO.test(plano) ? "" : x
}

// ── Textos ──────────────────────────────────────────────────────────────────

const SIN_TACC = /sin\s*tacc|gluten|cel[ií]ac/i

/**
 * Lo que no puede decir un anuncio. Vacío = se puede usar.
 *   · nada de «sin TACC / gluten free / apto celíacos» (no lo es ninguna marca)
 *   · precios solo los de Datos vigentes
 *   · títulos cortos (Meta corta a ~40)
 */
export function problemasCopy(c: { title: string; body: string }, preciosVigentes: string[]): string[] {
  const out: string[] = []
  const todo = `${c.title}\n${c.body}`
  if (SIN_TACC.test(todo)) out.push("menciona «sin TACC / gluten / celíacos»")
  const limpio = (s: string) => s.replace(/[\s$.]/g, "")
  const vig = preciosVigentes.map(limpio).filter(Boolean)
  for (const m of todo.matchAll(/\$\s?\d[\d.,]*/g)) {
    const p = limpio(m[0])
    if (!vig.some((v) => v === p || v.includes(p))) out.push(`precio que no está vigente: ${m[0].trim()}`)
  }
  if (!c.title.trim()) out.push("falta el título")
  if (c.title.length > 60) out.push("título muy largo (más de 60 letras)")
  if (!c.body.trim()) out.push("falta el texto")
  if (c.body.length > 600) out.push("texto muy largo (más de 600 letras)")
  return out
}

// ── Plantilla (público, ubicaciones, optimización) ──────────────────────────

const CTA_MENSAJE = new Set(["WHATSAPP_MESSAGE", "MESSAGE_PAGE", "INSTAGRAM_MESSAGE"])
export type PlantillaCand = { id: string; objective: string | null; cta_type: string | null; adset_id: string | null; last_date: string | null; totals: Partial<Numeros>; effective_status?: string | null }

/**
 * El conjunto que se copia para la propuesta. El del ganador si se puede; si su campaña es de un
 * objetivo viejo (Meta ya no deja crear anuncios en «MESSAGES», «LINK_CLICKS»…), el conjunto de
 * mensajes con objetivo nuevo que mejor rindió en la marca, del mismo destino si hay.
 */
export function elegirPlantilla<T extends PlantillaCand>(src: T | null, todos: T[]): T | null {
  // Lo archivado o borrado no se puede copiar.
  const vivo = (a: T) => !["ARCHIVED", "DELETED"].includes(a.effective_status ?? "")
  const usable = (a: T) => !!a.adset_id && vivo(a) && (a.objective ?? "").startsWith("OUTCOME_") && CTA_MENSAJE.has(a.cta_type ?? "")
  if (src && usable(src)) return src
  const cpc = (a: T) => ((a.totals.conversations ?? 0) >= 5 && a.totals.cost_per_conversation != null ? a.totals.cost_per_conversation : Number.POSITIVE_INFINITY)
  const mismo = (a: T) => Number(!!src && a.cta_type === src.cta_type)
  // Para anuncios de mensajes, primero Interacción (optimiza conversaciones); Tráfico, último recurso.
  const objetivo = (a: T) => Number(a.objective === "OUTCOME_ENGAGEMENT")
  return [...todos.filter(usable)].sort((x, y) => objetivo(y) - objetivo(x) || mismo(y) - mismo(x) || cpc(x) - cpc(y) || (y.last_date ?? "").localeCompare(x.last_date ?? ""))[0] ?? null
}

// ── E5 · Aprendizaje ────────────────────────────────────────────────────────

export type ResultadoPropuesta = {
  kind: TipoPropuesta
  /** Costo por conversación (API) del anuncio creado por el motor, y lo que gastó. */
  nuevo: { cost_per_conversation: number | null; spend: number; conversations: number }
  /** Costo por conversación (API) del anuncio de origen (o lo habitual de la marca si no hay). */
  origen: number | null
}
export type Aprendizaje = Record<TipoPropuesta, { medidos: number; ganados: number; tasa: number }>

/**
 * Qué tipo de propuesta le gana a su origen. Cuenta solo lo que ya gastó lo suficiente (5
 * conversaciones). La tasa parte de 0,5 (dos «medio ganados» de previa) para no exagerar con 1 dato.
 */
export function aprendizaje(rs: ResultadoPropuesta[]): Aprendizaje {
  const out = Object.fromEntries(TIPOS.map((k) => [k, { medidos: 0, ganados: 0, tasa: 0.5 }])) as Aprendizaje
  for (const r of rs) {
    if (r.nuevo.conversations < 5 || r.nuevo.cost_per_conversation == null || r.origen == null) continue
    const k = out[r.kind]
    k.medidos++
    if (r.nuevo.cost_per_conversation <= r.origen) k.ganados++
  }
  for (const k of TIPOS) out[k].tasa = (out[k].ganados + 1) / (out[k].medidos + 2)
  return out
}

// ── La tanda ────────────────────────────────────────────────────────────────

export type CandidatoAnuncio = {
  id: string
  apto: boolean
  /** Se puede re-editar: tiene tramos limpios, o un titular sin precio para rearmar sobre fotos reales. */
  reeditable: boolean
  tienePieza: boolean
  /** Diseño (titular normalizado): dos ganadores con el mismo diseño no van en la misma tanda. */
  grupo?: string
}
export type CandidatoOrganico = { media_id: string; apto: boolean }
export type Eleccion = { kind: TipoPropuesta; ad_id?: string; media_id?: string }

/**
 * De 3 a 5 propuestas: el mejor ganador limpio con texto nuevo, un ganador re-editado (de
 * preferencia uno que tenía precio quemado: es el que más se rescata), el mejor orgánico, una
 * variante sobre otro producto, y una quinta del tipo que más viene ganando (E5). No repite
 * fuentes usadas en las últimas semanas (`usados`).
 */
export function elegirTanda(p: {
  ganadores: CandidatoAnuncio[] // en orden de ranking
  organicos: CandidatoOrganico[] // en orden
  usados: Set<string> // "ad:<id>" / "media:<id>"
  combosActivos: number
  aprendido?: Aprendizaje
}): Eleccion[] {
  const out: Eleccion[] = []
  const tomado = new Set(p.usados)
  const grupoDe = new Map(p.ganadores.map((g) => [g.id, g.grupo]))
  const grupos = new Map<string, number>() // grupo → cuántas veces (reusar y variante pueden compartir)
  const libre = (k: string) => !tomado.has(k)
  const tomar = (e: Eleccion) => {
    out.push(e)
    tomado.add(e.ad_id ? `ad:${e.ad_id}` : `media:${e.media_id}`)
    const g = e.ad_id ? grupoDe.get(e.ad_id) : undefined
    if (g) grupos.set(g, (grupos.get(g) ?? 0) + 1)
  }
  const grupoLibre = (g: CandidatoAnuncio) => !g.grupo || !grupos.has(g.grupo)
  const aptos = () => p.ganadores.filter((g) => g.apto && g.tienePieza && libre(`ad:${g.id}`) && grupoLibre(g))

  const elegir: Record<TipoPropuesta, () => Eleccion | null> = {
    reusar: () => {
      const g = aptos()[0]
      return g ? { kind: "reusar", ad_id: g.id } : null
    },
    reeditar: () => {
      const libres = p.ganadores.filter((g) => g.reeditable && g.tienePieza && libre(`ad:${g.id}`) && grupoLibre(g))
      const g = libres.find((x) => !x.apto) ?? libres[0]
      return g ? { kind: "reeditar", ad_id: g.id } : null
    },
    organico: () => {
      const o = p.organicos.find((x) => x.apto && libre(`media:${x.media_id}`))
      return o ? { kind: "organico", media_id: o.media_id } : null
    },
    variante: () => {
      if (p.combosActivos < 2) return null
      const g = aptos()[0]
      return g ? { kind: "variante", ad_id: g.id } : null
    },
  }
  for (const k of TIPOS) {
    const e = elegir[k]()
    if (e) tomar(e)
  }
  // Hasta 5: más del tipo que más viene ganando (E5), si queda material.
  const orden = [...TIPOS].sort((a, b) => (p.aprendido?.[b].tasa ?? 0.5) - (p.aprendido?.[a].tasa ?? 0.5))
  // Vueltas hasta 5 mientras alguna agregue algo (si todo el material es de un tipo, sale de ese tipo).
  for (let sumo = true; sumo && out.length < 5; ) {
    sumo = false
    for (const k of orden) {
      if (out.length >= 5) break
      const e = elegir[k]()
      if (e) {
        tomar(e)
        sumo = true
      }
    }
  }
  return out
}

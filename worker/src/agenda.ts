/**
 * F8 · Agenda automática (worker). El cerebro está en shared/cos/agenda.ts (puro, con tests).
 *
 *   agenda:context   clima histórico (Open-Meteo archive) + feriados → cos_media.contexto
 *   agenda:learn     foto diaria del modelo de horarios por cuenta y formato (cos_slot_models)
 *   agenda:plan      elige día y hora de lo pendiente y reacomoda lo aprobado dentro de su ventana;
 *                    una vez por día además consulta al agente (IA) y valida lo que propone
 *   clima:stories    historias de clima (lluvia: aviso honesto; sol/frío/calor: si cambió)
 *   brand:hours      lee los horarios de apertura de la web de la marca (propuesta a confirmar)
 *
 * Nada de esto publica: deja horarios y borradores. Publicar sigue exigiendo la aprobación.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { PermanentError, type Job } from "./queue.ts"
import type { Handler } from "./handlers.ts"
import { brandContext, listMusic, placaDeMarca, settings } from "./handlers.ts"
import { elegirImagen, elegirMusica } from "./eleccion.ts"
import { planearSemana, writeClimaPhrase, leerHorarios } from "./ai.ts"
import { arDay, insertMissing } from "./context.ts"
import { defaultTemplate } from "./overlay.ts"
import {
  asignar,
  climaDeHora,
  deBA,
  enBA,
  modeloAgenda,
  normalizarApertura,
  primerTurno,
  abreEseDia,
  validarPropuesta,
  leerRitmo,
  horizonteDias,
  historiaDeClima,
  CONSIGNAS_CLIMA,
  type Apertura,
  type Asignacion,
  type ClimaCat,
  type Ocupado,
  type Pieza,
  type PostCtx,
  type Reglas,
} from "../../shared/cos/agenda.ts"
import { openDays, type Format } from "../../shared/cos/timing.ts"
import { climaCategoria } from "../../shared/cos/special-days.ts"

const LAT = -34.61
const LON = -58.38
const HORA = 3600_000

// ── Datos comunes ──────────────────────────────────────────────────────────

type MediaRow = { id: string; account_id: string; platform: string; format: Format; posted_at: string; metrics: Record<string, number>; contexto: PostCtx["contexto"] }

async function cargarMedia(db: SupabaseClient): Promise<MediaRow[]> {
  const out: MediaRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("cos_media")
      .select("id, account_id, platform, format, posted_at, metrics, contexto")
      .gte("posted_at", new Date(Date.now() - 400 * 86_400_000).toISOString())
      .order("posted_at")
      .range(from, from + 999)
    if (error) throw new Error(`cos_media: ${error.message}`)
    out.push(...((data ?? []) as MediaRow[]))
    if (!data || data.length < 1000) break
  }
  return out
}

async function cargarFeriados(db: SupabaseClient): Promise<Set<string>> {
  const { data } = await db.from("cos_special_days").select("day").in("kind", ["feriado", "puente"])
  return new Set((data ?? []).map((d) => d.day as string))
}

const valor = (m: MediaRow) => m.metrics?.reach || m.metrics?.views || 0
const aPost = (m: MediaRow): PostCtx => ({ postedAt: m.posted_at, format: m.format, reach: valor(m), contexto: m.contexto })

/**
 * Modelo de una cuenta y formato con pooling. Las historias se comparan solo con historias; si el
 * formato tiene poca historia propia, la cuenta presta sus otros formatos (como en F1).
 */
function modeloPara(media: MediaRow[], accountId: string, platform: string, format: Format, feriados: Set<string>) {
  const esHistoria = format === "story"
  const mismo = (m: MediaRow) => (esHistoria ? m.format === "story" : m.format !== "story")
  const propiosFormato = media.filter((m) => m.account_id === accountId && m.format === format && valor(m) > 0)
  const propios = propiosFormato.length >= 8 ? propiosFormato : media.filter((m) => m.account_id === accountId && mismo(m) && valor(m) > 0)
  const todos = media.filter((m) => m.platform === platform && mismo(m) && valor(m) > 0)
  return modeloAgenda(propios.map(aPost), todos.map(aPost), feriados)
}

// ── agenda:context ─────────────────────────────────────────────────────────

/** Clima histórico por hora de Buenos Aires (archivo de Open-Meteo, gratis), por años. */
async function traerArchivo(db: SupabaseClient, desde: string, hasta: string) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&start_date=${desde}&end_date=${hasta}&hourly=weather_code,temperature_2m,precipitation&timezone=UTC`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`clima histórico ${desde}…${hasta}: HTTP ${res.status}`)
  const h = ((await res.json()) as { hourly: { time: string[]; weather_code: (number | null)[]; temperature_2m: (number | null)[]; precipitation: (number | null)[] } }).hourly
  const rows = h.time.map((t, i) => ({ ts: `${t}:00Z`, code: h.weather_code[i], temp: h.temperature_2m[i], precip_mm: h.precipitation[i], precip_prob: null, source: "archive", updated_at: new Date().toISOString() }))
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db.from("cos_weather_hourly").upsert(rows.slice(i, i + 1000), { onConflict: "ts" })
    if (error) throw new Error(`cos_weather_hourly: ${error.message}`)
  }
  return rows.length
}

/**
 * Le pega a cada publicación el clima de la hora en que salió y si era feriado/puente/fecha
 * especial. Idempotente: solo lo que no tiene contexto (o quedó sin clima porque no había datos).
 */
const contextoMedia: Handler = async (_job, { db, log }) => {
  const { data: pend, error } = await db.from("cos_media").select("posted_at").is("contexto_at", null).order("posted_at").limit(1)
  if (error) throw new Error(`cos_media: ${error.message}`)
  if (!pend?.length) return log("contexto de publicaciones: nada pendiente")

  // Feriados de años viejos (argentinadatos los tiene desde ~2016) para las publicaciones viejas.
  const primerAnio = Number(pend[0].posted_at.slice(0, 4))
  const hoy = arDay(new Date())
  const { data: yaFer } = await db.from("cos_special_days").select("day, name").in("kind", ["feriado", "puente"])
  const tengo = new Set((yaFer ?? []).map((f) => `${f.day}|${f.name}`))
  for (let y = Math.max(primerAnio, 2012); y < Number(hoy.slice(0, 4)); y++) {
    const r = await fetch(`https://api.argentinadatos.com/v1/feriados/${y}`).catch(() => null)
    if (!r?.ok) continue
    const lista = (await r.json()) as { fecha: string; tipo: string; nombre: string }[]
    const nuevos = lista
      .filter((f) => !tengo.has(`${f.fecha}|${f.nombre}`))
      .map((f) => ({ day: f.fecha, name: f.nombre.slice(0, 80), kind: f.tipo === "puente" ? "puente" : "feriado", brand_id: null, source: "argentinadatos", hint: null }))
    if (nuevos.length) await insertMissing(db, nuevos).catch((e) => log("feriados viejos", { error: String(e) }))
  }

  // Clima histórico: del día de la publicación más vieja sin contexto hasta ayer, por años.
  const ayer = arDay(new Date(Date.now() - 86_400_000))
  const { data: ultimo } = await db.from("cos_weather_hourly").select("ts").eq("source", "archive").order("ts", { ascending: false }).limit(1)
  let desde = pend[0].posted_at.slice(0, 10)
  if (ultimo?.length && ultimo[0].ts.slice(0, 10) > desde) desde = ultimo[0].ts.slice(0, 10)
  let horas = 0
  for (let ini = desde; ini <= ayer; ) {
    const fin = `${ini.slice(0, 4)}-12-31` < ayer ? `${ini.slice(0, 4)}-12-31` : ayer
    horas += await traerArchivo(db, ini, fin)
    ini = `${Number(ini.slice(0, 4)) + 1}-01-01`
  }

  const feriados = await cargarFeriados(db)
  const { data: especiales } = await db.from("cos_special_days").select("day, name").eq("kind", "especial").is("brand_id", null)
  const especial = new Map((especiales ?? []).map((e) => [e.day as string, e.name as string]))
  let hechos = 0
  for (;;) {
    const { data: lote } = await db.from("cos_media").select("id, posted_at").is("contexto_at", null).order("posted_at").limit(200)
    if (!lote?.length) break
    const horasLote = [...new Set(lote.map((m) => new Date(Math.floor(Date.parse(m.posted_at) / HORA) * HORA).toISOString()))]
    const { data: clima } = await db.from("cos_weather_hourly").select("ts, code, temp, precip_mm, precip_prob").in("ts", horasLote)
    const porHora = new Map((clima ?? []).map((c) => [new Date(c.ts).toISOString(), c]))
    // De a 25 en paralelo (no saturar Supabase).
    for (let i = 0; i < lote.length; i += 25) {
      await Promise.all(
        lote.slice(i, i + 25).map(async (m) => {
          const h = porHora.get(new Date(Math.floor(Date.parse(m.posted_at) / HORA) * HORA).toISOString())
          const dia = enBA(new Date(m.posted_at)).dia
          const contexto = { clima: h ? climaDeHora(h) : null, temp: h?.temp ?? null, feriado: feriados.has(dia), especial: especial.get(dia) ?? null }
          const { error: ue } = await db.from("cos_media").update({ contexto, contexto_at: new Date().toISOString() }).eq("id", m.id)
          if (ue) throw new Error(`contexto de ${m.id}: ${ue.message}`)
        }),
      )
    }
    hechos += lote.length
  }
  log("contexto de publicaciones listo", { horasDeClima: horas, publicaciones: hechos })
}

// ── agenda:learn ───────────────────────────────────────────────────────────

const aprenderAgenda: Handler = async (_job, { db, log }) => {
  const [media, feriados] = await Promise.all([cargarMedia(db), cargarFeriados(db)])
  const { data: cuentas } = await db.from("cos_social_accounts").select("id, brand_id, platform").neq("status", "disabled").in("platform", ["instagram", "facebook"])
  let fotos = 0
  for (const c of cuentas ?? []) {
    const formatos = [...new Set(media.filter((m) => m.account_id === c.id).map((m) => m.format))]
    for (const f of formatos) {
      const m = modeloPara(media, c.id, c.platform, f, feriados)
      await db.from("cos_slot_models").insert({
        account_id: c.id,
        brand_id: c.brand_id,
        format: f,
        n: m.n,
        model_json: { grid: m.slot.grid.map((r) => r.map((v) => Math.round(v * 1000) / 1000)), hourN: m.slot.hourN, efectos: m.efectos, peso: m.peso, nPool: m.nPool },
      })
      fotos++
    }
  }
  log("modelos de horario guardados", { fotos })
}

// ── agenda:plan ────────────────────────────────────────────────────────────

type PostPlan = {
  id: string
  created_at: string
  account_id: string
  status: string
  post_type: Format
  campaign: string | null
  scheduled_at: string | null
  window_start: string | null
  window_end: string | null
  schedule_lock: boolean
  schedule_source: string | null
  schedule_reason: string | null
  schedule_log: unknown[]
  cos_social_accounts: { platform: string } | null
  cos_post_media?: { position: number; cos_asset_versions: { asset_id: string } | null }[]
}

/** La subida de un post: el archivo de su primera pieza. */
const subidaDe = (p: PostPlan) => [...(p.cos_post_media ?? [])].sort((a, b) => a.position - b.position)[0]?.cos_asset_versions?.asset_id ?? null

async function climaFuturo(db: SupabaseClient): Promise<Map<string, ClimaCat>> {
  const { data } = await db.from("cos_weather_hourly").select("ts, code, temp, precip_mm, precip_prob").gte("ts", new Date().toISOString()).order("ts").limit(400)
  return new Map((data ?? []).map((h) => [new Date(h.ts).toISOString(), climaDeHora(h)]))
}

export async function reglasDeMarca(db: SupabaseClient, brandId: string, clima?: Map<string, ClimaCat>, feriados?: Set<string>): Promise<Reglas> {
  const { data: b } = await db.from("cos_brands").select("open_hours, rules_json, ritmo").eq("id", brandId).single()
  return {
    desde: new Date(),
    // El mes en curso (08-10-2026); con el ritmo de la marca, la agenda llena semana por semana.
    dias: horizonteDias(),
    ritmo: leerRitmo(b?.ritmo),
    horaMin: 9,
    horaMax: 22,
    apertura: normalizarApertura(b?.open_hours),
    diasTexto: openDays((b?.rules_json as { open_days?: string } | null)?.open_days),
    feriados,
    clima,
    explorarCada: 6,
  }
}

/** Pieza del asignador a partir de un post (feriado y clima tienen día fijo). */
function aPieza(p: PostPlan): Pieza {
  const pieza: Pieza = { id: p.id, account: p.account_id, format: p.post_type, actual: p.scheduled_at, creada: p.created_at }
  const m = /^(feriado|clima):(\d{4}-\d{2}-\d{2})/.exec(p.campaign ?? "")
  if (m) {
    pieza.dia = m[2]
    if (m[1] === "clima") {
      pieza.antesDelServicio = true
      // Sin horarios de apertura confirmados, el límite es el que se calculó al crearla.
      if (p.window_end) pieza.antesDe = p.window_end
    }
    // Historias de feriado: la del feriado mismo va ese día; las anteriores, su día (ya calculado).
    if (m[1] === "feriado" && p.scheduled_at) pieza.dia = enBA(new Date(p.scheduled_at)).dia
  }
  if (p.status !== "PENDING_APPROVAL" && p.window_start && p.window_end) pieza.ventana = { desde: p.window_start, hasta: p.window_end }
  return pieza
}

type Insumos = [MediaRow[], Set<string>, Map<string, ClimaCat>, Awaited<ReturnType<typeof settings>>]
const insumosAgenda = (db: SupabaseClient): Promise<Insumos> => Promise.all([cargarMedia(db), cargarFeriados(db), climaFuturo(db), settings(db)])
type Marca = { id: string; slug: string; name: string }
type Log = (msg: string, extra?: Record<string, unknown>) => void

const planearAgenda: Handler = async (job, { db, log }) => {
  const soloMarca = typeof job.payload.brand_id === "string" ? job.payload.brand_id : null
  const conAgente = job.payload.agente === true
  let q = db.from("cos_brands").select("id, slug, name").eq("active", true).eq("agenda_auto", true)
  if (soloMarca) q = q.eq("id", soloMarca)
  const { data: marcas } = await q
  if (!marcas?.length) return
  const insumos = await insumosAgenda(db)
  for (const b of marcas) await planearMarca(db, log, b, insumos, { conAgente })
}

/**
 * Planifica una marca (lo pendiente y lo aprobado con ventana). `prioridades` = quién va primero al
 * repartir lugares (la replanificación del mes manda las mejores piezas primero); `dias` = horizonte
 * distinto del de siempre. Devuelve qué quedó ubicado y qué no tuvo lugar.
 */
async function planearMarca(db: SupabaseClient, log: Log, b: Marca, [media, feriados, clima, s]: Insumos, opts: { conAgente?: boolean; prioridades?: Map<string, number>; dias?: number } = {}): Promise<{ ubicadas: string[]; sinLugar: string[] }> {
  {
    const reglas: Reglas = { ...(await reglasDeMarca(db, b.id, clima, feriados)), ...(opts.dias != null ? { dias: opts.dias } : {}) }
    const { data: posts, error } = await db
      .from("cos_posts")
      .select("id, created_at, account_id, status, post_type, campaign, scheduled_at, window_start, window_end, schedule_lock, schedule_source, schedule_reason, schedule_log, cos_social_accounts(platform), cos_post_media(position, cos_asset_versions(asset_id))")
      .eq("brand_id", b.id)
      .in("status", ["PENDING_APPROVAL", "APPROVED", "SCHEDULED", "PAUSED", "RETRY_SCHEDULED", "PUBLISHING", "PUBLISHED"])
      .is("deleted_at", null)
      .or(`scheduled_at.is.null,scheduled_at.gte.${new Date(Date.now() - 36 * HORA).toISOString()}`)
    if (error) throw new Error(`posts: ${error.message}`)
    const todos = (posts ?? []) as unknown as PostPlan[]
    const ahora = Date.now()
    // Lo que el motor puede ubicar: lo pendiente que no se fijó a mano, y lo aprobado con ventana
    // que sale en más de 3 h.
    const movibles = todos.filter(
      (p) =>
        !p.schedule_lock &&
        p.schedule_source !== "manual" &&
        (p.status === "PENDING_APPROVAL" ||
          (p.status === "SCHEDULED" && !!p.window_start && !!p.scheduled_at && Date.parse(p.scheduled_at) > ahora + 3 * HORA)),
    )
    // Una historia de feriado/clima pendiente cuya hora ya pasó se vence sola (no se reubica).
    const piezas = movibles
      .filter((p) => !(p.status === "PENDING_APPROVAL" && p.campaign && p.scheduled_at && Date.parse(p.scheduled_at) <= ahora))
      .map((p) => ({ ...aPieza(p), prioridad: opts.prioridades?.get(p.id) }))
    const ids = new Set(piezas.map((p) => p.id))
    // Historia de una subida → después de su reel/post de Instagram (el de la misma cuenta y el mismo archivo).
    for (const pz of piezas) {
      if (pz.format !== "story" || pz.dia) continue
      const yo = todos.find((t) => t.id === pz.id)!
      const sub = subidaDe(yo)
      if (!sub) continue
      const hermano = todos.find((t) => t.id !== yo.id && t.account_id === yo.account_id && ["reel", "feed", "carousel"].includes(t.post_type) && subidaDe(t) === sub && !["CANCELLED", "REJECTED", "EXPIRED"].includes(t.status))
      if (!hermano) continue
      if (ids.has(hermano.id)) pz.despuesDe = hermano.id
      else if (hermano.scheduled_at) pz.despuesDeAt = hermano.scheduled_at
    }
    const ocupados: Ocupado[] = todos
      .filter((p) => !ids.has(p.id) && p.scheduled_at && p.status !== "PENDING_APPROVAL")
      .map((p) => ({ account: p.account_id, format: p.post_type, at: p.scheduled_at! }))
    if (!piezas.length) return { ubicadas: [], sinLugar: [] }

    const modelos = new Map<string, ReturnType<typeof modeloPara>>()
    const plataforma = new Map(todos.map((p) => [p.account_id, p.cos_social_accounts?.platform ?? "instagram"]))
    const modeloDe = (p: Pieza) => {
      const k = `${p.account}:${p.format}`
      if (!modelos.has(k)) modelos.set(k, modeloPara(media, p.account, plataforma.get(p.account) ?? "instagram", p.format, feriados))
      return modelos.get(k)!
    }
    const base = asignar(piezas, modeloDe, ocupados, reglas)
    let plan: Asignacion[] = base.asignadas
    let nota: string | null = null
    let agente: "ia" | "motor" = "motor"

    if (opts.conAgente) {
      // El agente mira el plan del motor con el contexto de la semana y propone ajustes; el código
      // los valida con las mismas reglas. Si la IA falla, queda el plan del motor.
      try {
        const brand = await brandContext(db, b.id)
        const m0 = modeloDe(piezas[0])
        const r = await planearSemana({
          db,
          model: s.ai_model,
          brand,
          // El agente mira solo las próximas 2 semanas (con clima y fechas cercanas); lo demás es del motor.
          plan: plan
            .filter((a) => Date.parse(a.at) < Date.now() + 14 * 24 * HORA)
            .map((a) => ({ post_id: a.id, formato: piezas.find((x) => x.id === a.id)!.format, at: a.at, porque: a.porque, fijo: !!piezas.find((x) => x.id === a.id)!.dia })),
          efectos: m0.efectos.filter((e) => e.claro),
          clima: resumenClima(clima),
          fechas: await proximasFechas(db, b.id),
          apertura: reglas.apertura,
          sugerencias: await sugerenciasDeLaSemana(db, b.id),
        })
        const v = validarPropuesta(r.cambios, plan, piezas, ocupados, reglas)
        plan = v.plan
        nota = r.nota + (v.descartadas.length ? `\n(Descartado por no cumplir las reglas: ${v.descartadas.map((d) => d.motivo).join("; ")})` : "")
        agente = "ia"
      } catch (e) {
        log("el agente de la agenda no respondió: queda el plan del motor", { brand: b.slug, error: String(e).slice(0, 300) })
      }
    }

    let cambios = 0
    for (const a of plan) {
      const p = todos.find((x) => x.id === a.id)!
      if (p.scheduled_at && Date.parse(p.scheduled_at) === Date.parse(a.at) && p.schedule_reason === a.porque) continue
      if (p.status === "PENDING_APPROVAL") {
        const { error: ue } = await db
          .from("cos_posts")
          .update({ scheduled_at: a.at, window_start: a.ventana.desde, window_end: a.ventana.hasta, schedule_source: a.fuente, schedule_reason: a.porque, predicted_lift: a.lift })
          .eq("id", a.id)
          .eq("brand_id", b.id)
          .eq("status", "PENDING_APPROVAL")
        if (ue) log("no se pudo ubicar el borrador", { post: a.id, error: ue.message })
        else cambios++
      } else if (p.scheduled_at && Date.parse(p.scheduled_at) !== Date.parse(a.at)) {
        // Aprobado: solo la hora, dentro de su ventana (la base lo exige) y queda registrado.
        const registro = [...(Array.isArray(p.schedule_log) ? p.schedule_log : []), { de: p.scheduled_at, a: a.at, porque: a.porque, cuando: new Date().toISOString() }].slice(-20)
        const { error: ue } = await db
          .from("cos_posts")
          .update({ scheduled_at: a.at, schedule_reason: a.porque, predicted_lift: a.lift, schedule_log: registro })
          .eq("id", a.id)
          .eq("brand_id", b.id)
          .eq("status", "SCHEDULED")
        if (ue) log("no se pudo reacomodar (la base lo frenó)", { post: a.id, error: ue.message })
        else cambios++
      }
    }
    if (opts.conAgente || cambios) {
      await db.from("cos_agenda_plans").insert({ brand_id: b.id, plan_json: plan.map((a) => ({ post_id: a.id, at: a.at, porque: a.porque, fuente: a.fuente })), nota, agente })
    }
    log("agenda planeada", { brand: b.slug, piezas: piezas.length, cambios, sinLugar: base.sinLugar.length, agente })
    return { ubicadas: plan.map((a) => a.id), sinLugar: base.sinLugar.map((x) => x.id) }
  }
}

// ── agenda:replan · "todo en el mes" ────────────────────────────────────────
type Candidata = {
  id: string
  status: string
  account_id: string
  post_type: Format
  scheduled_at: string | null
  schedule_lock: boolean
  approved_by: string | null
  approved_at: string | null
  avisos: unknown
  montaje: { respaldo?: boolean } | null
  render_qa: { score?: number } | null
  cos_post_media: { position: number; cos_asset_versions: { asset_id: string; cos_assets: { quality_score: number | null; ai_json: { commercial_value?: number; risk_flags?: string[] } | null } | null } | null }[]
}

/** Qué tan buena es una pieza para elegir cuáles entran cuando no entra todo (0–250, mayor = mejor). */
export function puntajeDePieza(p: Pick<Candidata, "avisos" | "montaje" | "render_qa" | "cos_post_media">): number {
  const a = [...p.cos_post_media].sort((x, y) => x.position - y.position)[0]?.cos_asset_versions?.cos_assets
  const ai = a?.ai_json ?? {}
  let s = (a?.quality_score ?? 50) + (ai.commercial_value ?? 50) / 2 + (p.render_qa?.score ?? 70) / 2
  if (Array.isArray(p.avisos) && p.avisos.length) s -= 30 // nombra ingredientes que no se ven
  if (p.montaje?.respaldo) s -= 20 // guion de respaldo, sin IA
  s -= 10 * (ai.risk_flags?.length ?? 0)
  return Math.round(s)
}

/**
 * agenda:replan — "trabajemos solo con octubre: reordená todo lo programado, lo mejor que tengamos,
 * todo en el mes; lo que sobre vuelve a la base" (Javier, 08-10-2026). Por marca:
 *  1. Candidatas: lo aprobado/programado que sale en más de 3 h. Lo fijado a mano DENTRO del horizonte
 *     se respeta como ancla; lo fijado a mano fuera del horizonte también se reordena.
 *  2. Vuelven a pendiente (guardando quién y cuándo las aprobó) y el planificador las ubica por puntaje
 *     (puntajeDePieza) con el ritmo, la apertura y el horizonte del mes.
 *  3. Las ubicadas se vuelven a aprobar en nombre de quien las había aprobado. Las que no entran (y la
 *     historia de un reel que no entró) quedan pendientes, sin hora, con la razón "sobró para el mes".
 * Payload: { brand_id?: string }.
 */
const replanificarMes: Handler = async (job, { db, log }) => {
  const soloMarca = typeof job.payload.brand_id === "string" ? job.payload.brand_id : null
  let q = db.from("cos_brands").select("id, slug, name").eq("active", true)
  if (soloMarca) q = q.eq("id", soloMarca)
  const { data: marcas } = await q
  if (!marcas?.length) return
  const insumos = await insumosAgenda(db)
  const dias = horizonteDias()
  const hoy = enBA(new Date()).dia
  const limite = deBA(new Date(Date.parse(`${hoy}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10), 24 * 60 - 1)
  const ahora = Date.now()

  for (const b of marcas) {
    const { data, error } = await db
      .from("cos_posts")
      .select(
        "id, status, account_id, post_type, scheduled_at, schedule_lock, approved_by, approved_at, avisos, montaje, render_qa, cos_post_media(position, cos_asset_versions(asset_id, cos_assets!cos_asset_versions_asset_id_fkey(quality_score, ai_json)))",
      )
      .eq("brand_id", b.id)
      .in("status", ["APPROVED", "SCHEDULED"])
      .gte("scheduled_at", new Date(ahora + 3 * HORA).toISOString())
    if (error) throw new Error(`posts: ${error.message}`)
    const todas = (data ?? []) as unknown as Candidata[]
    const candidatas = todas.filter((p) => !(p.schedule_lock && p.scheduled_at && Date.parse(p.scheduled_at) <= limite.getTime()))
    if (!candidatas.length) {
      log("replan: nada que reordenar", { brand: b.slug })
      continue
    }
    const prioridades = new Map(candidatas.map((p) => [p.id, puntajeDePieza(p)]))
    const aprobacion = new Map(candidatas.map((p) => [p.id, { by: p.approved_by, at: p.approved_at }]))
    const subida = (p: Candidata) => [...p.cos_post_media].sort((x, y) => x.position - y.position)[0]?.cos_asset_versions?.asset_id ?? null

    // 1) Todas vuelven a pendiente, sin hora ni ventana: el planificador decide de cero.
    let devueltas = 0
    for (const p of candidatas) {
      const { error: e } = await db
        .from("cos_posts")
        .update({ status: "PENDING_APPROVAL", scheduled_at: null, window_start: null, window_end: null, schedule_lock: false, schedule_source: null, schedule_reason: "Reordenando el mes" })
        .eq("id", p.id)
        .in("status", ["APPROVED", "SCHEDULED"])
      if (e) log("replan: no se pudo devolver a pendiente", { post: p.id, error: e.message })
      else devueltas++
    }

    // 2) El planificador las ubica por puntaje, dentro del mes.
    await planearMarca(db, log, b, insumos, { prioridades, dias })

    // 3) Las que quedaron con hora dentro del horizonte se vuelven a aprobar; la historia de un reel que
    //    no entró, tampoco entra.
    const { data: ahoraPend } = await db.from("cos_posts").select("id, scheduled_at").in("id", candidatas.map((p) => p.id)).eq("status", "PENDING_APPROVAL")
    const conHora = new Set((ahoraPend ?? []).filter((p) => p.scheduled_at && Date.parse(p.scheduled_at) <= limite.getTime()).map((p) => p.id))
    const porId = new Map(candidatas.map((p) => [p.id, p]))
    const entra = (p: Candidata): boolean => {
      if (!conHora.has(p.id)) return false
      if (p.post_type !== "story") return true
      const sub = subida(p)
      const hermano = candidatas.find((h) => h.id !== p.id && h.account_id === p.account_id && h.post_type !== "story" && subida(h) === sub)
      return hermano ? conHora.has(hermano.id) : true
    }
    let reaprobadas = 0
    const sobraron: Candidata[] = []
    for (const id of candidatas.map((p) => p.id)) {
      const p = porId.get(id)!
      if (!entra(p)) {
        sobraron.push(p)
        continue
      }
      const ap = aprobacion.get(id)!
      const { error: e1 } = await db
        .from("cos_posts")
        .update({ status: "APPROVED", approved_by: ap.by, approved_at: ap.at ?? new Date().toISOString() })
        .eq("id", id)
        .eq("status", "PENDING_APPROVAL")
      if (e1) {
        log("replan: no se pudo volver a aprobar", { post: id, error: e1.message })
        continue
      }
      const { error: e2 } = await db.from("cos_posts").update({ status: "SCHEDULED" }).eq("id", id)
      if (e2) log("replan: no se pudo programar", { post: id, error: e2.message })
      else reaprobadas++
    }
    for (const p of sobraron) {
      await db
        .from("cos_posts")
        .update({ scheduled_at: null, window_start: null, window_end: null, schedule_source: null, schedule_reason: "Sobró para el mes: vuelve a la cola y se programa cuando haya lugar" })
        .eq("id", p.id)
        .eq("status", "PENDING_APPROVAL")
    }
    await db.from("cos_audit_log").insert({
      event: "agenda:replan",
      entity_type: "brand",
      entity_id: b.id,
      actor: "worker",
      details_json: { hasta: limite.toISOString(), candidatas: candidatas.length, devueltas, reaprobadas, sobraron: sobraron.map((p) => ({ id: p.id, tipo: p.post_type, puntaje: prioridades.get(p.id) })) },
    })
    log("replan del mes", { brand: b.slug, hasta: limite.toISOString().slice(0, 10), candidatas: candidatas.length, reaprobadas, sobraron: sobraron.length })
  }
}

// ── historias:auto · clima y feriado siempre aprobadas ──────────────────────
/**
 * Las historias automáticas (clima, feriado) salen solas (Javier, 08-10-2026: "por ahora siempre
 * aprobadas"): cada hora, las pendientes con su pieza final lista y hora futura se aprueban en nombre
 * del aprobador configurado (cos_settings.aprobador_auto). Se apaga con historias_auto = false.
 */
const aprobarHistoriasAutomaticas: Handler = async (_job, { db, log }) => {
  const { data: s } = await db.from("cos_settings").select("historias_auto, aprobador_auto").eq("id", true).single()
  if (!s?.historias_auto || !s.aprobador_auto) return
  const { data } = await db
    .from("cos_posts")
    .select("id, campaign")
    .eq("status", "PENDING_APPROVAL")
    .or("campaign.like.clima:*,campaign.like.feriado:*")
    .not("render_qa", "is", null)
    .gte("scheduled_at", new Date(Date.now() + 5 * 60_000).toISOString())
  let n = 0
  for (const p of data ?? []) {
    const { error: e1 } = await db.from("cos_posts").update({ status: "APPROVED", approved_by: s.aprobador_auto, approved_at: new Date().toISOString() }).eq("id", p.id).eq("status", "PENDING_APPROVAL")
    if (e1) {
      log("historia automática: no se pudo aprobar", { post: p.id, error: e1.message })
      continue
    }
    const { error: e2 } = await db.from("cos_posts").update({ status: "SCHEDULED" }).eq("id", p.id)
    if (e2) log("historia automática: no se pudo programar", { post: p.id, error: e2.message })
    else n++
  }
  if (n) log("historias automáticas aprobadas", { n })
}

/** Lo que el motor de gustos (F7 M3) sugiere hacer esta semana: un solo plan, gustos dice qué y la agenda cuándo. */
async function sugerenciasDeLaSemana(db: SupabaseClient, brandId: string): Promise<string[]> {
  const { data } = await db.from("cos_suggestions").select("items_json").eq("brand_id", brandId).eq("kind", "contenido").order("week", { ascending: false }).limit(1)
  const items = (data?.[0]?.items_json as { items?: { titulo: string }[] } | undefined)?.items ?? []
  return items.map((i) => i.titulo).slice(0, 5)
}

function resumenClima(clima: Map<string, ClimaCat>): { dia: string; tarde: ClimaCat | null; noche: ClimaCat | null }[] {
  const dias = new Map<string, { tarde: ClimaCat[]; noche: ClimaCat[] }>()
  for (const [ts, c] of clima) {
    const { dia, min } = enBA(new Date(ts))
    const d = dias.get(dia) ?? { tarde: [], noche: [] }
    if (min >= 12 * 60 && min < 18 * 60) d.tarde.push(c)
    if (min >= 18 * 60 && min <= 23 * 60) d.noche.push(c)
    dias.set(dia, d)
  }
  const peor = (xs: ClimaCat[]) => (xs.includes("tormenta") ? "tormenta" : xs.includes("lluvia") ? "lluvia" : (xs[Math.floor(xs.length / 2)] ?? null))
  return [...dias.entries()].slice(0, 14).map(([dia, d]) => ({ dia, tarde: peor(d.tarde), noche: peor(d.noche) }))
}

async function proximasFechas(db: SupabaseClient, brandId: string) {
  const hoy = arDay(new Date())
  const hasta = arDay(new Date(Date.now() + 14 * 86_400_000))
  const { data } = await db.from("cos_special_days").select("day, name, kind").gte("day", hoy).lte("day", hasta).or(`brand_id.is.null,brand_id.eq.${brandId}`).order("day")
  return (data ?? []).map((d) => ({ dia: d.day as string, nombre: d.name as string, tipo: d.kind as string }))
}

// ── clima:stories ──────────────────────────────────────────────────────────

/** Clima "del servicio" de un día: el peor de las horas cercanas al turno (o de 17 a 23). */
function climaDelServicio(clima: Map<string, ClimaCat>, dia: string, abreMin: number | null): ClimaCat | null {
  const ini = Math.max(9 * 60, (abreMin ?? 19 * 60) - 120)
  const fin = Math.min(23 * 60, (abreMin ?? 19 * 60) + 240)
  const horas: ClimaCat[] = []
  for (let m = ini; m <= fin; m += 60) {
    const c = clima.get(new Date(Math.floor(deBA(dia, m).getTime() / HORA) * HORA).toISOString())
    if (c) horas.push(c)
  }
  if (!horas.length) return null
  if (horas.includes("tormenta")) return "tormenta"
  if (horas.filter((h) => h === "lluvia").length >= 2) return "lluvia"
  const cuenta = new Map<ClimaCat, number>()
  for (const h of horas) cuenta.set(h, (cuenta.get(h) ?? 0) + 1)
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

const historiasClima: Handler = async (_job, { db, queue, log }) => {
  const clima = await climaFuturo(db)
  const hoy = arDay(new Date())
  const manana = arDay(new Date(Date.now() + 86_400_000))
  const { data: marcas } = await db.from("cos_brands").select("id, slug, rules_json, open_hours, agenda_auto").eq("active", true).eq("clima_historias", true)
  const { data: diarios } = await db.from("cos_weather_daily").select("day, code, tmax, tmin, rain_prob").gte("day", arDay(new Date(Date.now() - 86_400_000))).lte("day", manana)
  const catDiaria = (dia: string) => {
    const d = diarios?.find((x) => x.day === dia)
    const c = d ? climaCategoria(d) : null
    return c ? (c as ClimaCat) : null
  }
  const s = await settings(db)
  for (const b of marcas ?? []) {
    const { data: ig } = await db.from("cos_social_accounts").select("id").eq("brand_id", b.id).eq("platform", "instagram").neq("status", "disabled").limit(1)
    if (!ig?.length) continue
    const ap: Apertura | null = normalizarApertura(b.open_hours)
    const diasTexto = openDays((b.rules_json as { open_days?: string } | null)?.open_days)

    // 1. Las ya creadas: si el pronóstico cambió y ya no corresponde, se vencen (o se cancelan).
    const { data: vivas } = await db
      .from("cos_posts")
      .select("id, status, campaign")
      .eq("brand_id", b.id)
      .like("campaign", "clima:%")
      .in("status", ["PENDING_APPROVAL", "SCHEDULED", "PAUSED"])
      .gt("scheduled_at", new Date().toISOString())
    for (const v of vivas ?? []) {
      const [, dia, tipo] = (v.campaign as string).split(":")
      const abre = primerTurno(ap, new Date(`${dia}T12:00:00Z`).getUTCDay())
      const ahora = historiaDeClima(climaDelServicio(clima, dia, abre) ?? catDiaria(dia), catDiaria(prevDia(dia)))
      // Sin pronóstico cargado no se decide nada (se revisa en la próxima vuelta).
      if (ahora === tipo || !clima.size) continue
      const nuevo = v.status === "PENDING_APPROVAL" ? "EXPIRED" : "CANCELLED"
      await db.from("cos_posts").update({ status: nuevo, last_error: `Cambió el pronóstico: ya no corresponde la historia de ${tipo}` }).eq("id", v.id)
      log("historia de clima vencida por cambio de pronóstico", { brand: b.slug, dia, tipo, ahora })
    }

    // 2. Las que faltan (hoy, si todavía hay tiempo antes del servicio, y mañana).
    for (const dia of [hoy, manana]) {
      const dow = new Date(`${dia}T12:00:00Z`).getUTCDay()
      if (!abreEseDia(ap, dow, diasTexto)) continue
      const abre = primerTurno(ap, dow) ?? 19 * 60
      const tipo = historiaDeClima(climaDelServicio(clima, dia, abre) ?? catDiaria(dia), catDiaria(prevDia(dia)))
      if (!tipo) continue
      const campaign = `clima:${dia}:${tipo}`
      const { data: existe } = await db.from("cos_posts").select("id").eq("brand_id", b.id).like("campaign", `clima:${dia}:%`).not("status", "in", "(EXPIRED,CANCELLED)").limit(1)
      if (existe?.length) continue
      // Hora por defecto: 2 h antes de que abra (la agenda la ajusta si está prendida).
      const at = deBA(dia, Math.max(10 * 60, abre - 120))
      if (at.getTime() < Date.now() + 2 * HORA) continue
      const brand = await brandContext(db, b.id)
      const { consigna, respaldo } = CONSIGNAS_CLIMA[tipo]
      const frase = await writeClimaPhrase({ db, model: s.ai_model, brand, consigna }).catch((e) => {
        log("historia de clima: la IA no escribió, va el texto de respaldo", { error: String(e) })
        return respaldo
      })
      const version = await fondoHistoria(db, queue, b, campaign)
      if (!version) {
        log("historia de clima: la placa de fondo se está preparando, sigue en la próxima vuelta", { brand: b.slug })
        continue
      }
      const music = await listMusic(db, b.slug)
      // Clima = campaña: el motor de gustos elige lo que mejor viene rindiendo, sin probar.
      const tema = music.length ? await elegirMusica(db, { brandId: b.id, format: "story", disponibles: music, semilla: campaign, campania: true }) : null
      const plantilla = defaultTemplate(b.slug)
      const { data: post, error } = await db
        .from("cos_posts")
        .insert({
          brand_id: b.id,
          account_id: ig[0].id,
          platform: "instagram",
          post_type: "story",
          caption: "",
          hashtags: "",
          overlay_text: frase.slice(0, 80),
          template: ["firma", "none"].includes(plantilla) ? "etiqueta" : plantilla,
          music_key: tema?.key ?? null,
          pick_json: tema?.pick ?? null,
          campaign,
          uses_weather: true,
          scheduled_at: at.toISOString(),
          window_start: deBA(dia, 9 * 60).toISOString(),
          window_end: deBA(dia, Math.max(10 * 60, abre - 60)).toISOString(),
          schedule_source: "fijo",
          schedule_reason: `Antes del servicio · ${tipo === "lluvia" || tipo === "tormenta" ? "aviso de lluvia" : `día de ${tipo}`}`,
          status: "DRAFT",
        })
        .select("id")
        .single()
      if (error || !post) {
        if (error?.code === "23505") continue
        throw new Error(`historia de clima: ${error?.message}`)
      }
      const { error: me } = await db.from("cos_post_media").insert({ post_id: post.id, version_id: version, position: 0 })
      if (me) throw new Error(`historia de clima (archivo): ${me.message}`)
      await db.from("cos_posts").update({ status: "PENDING_APPROVAL" }).eq("id", post.id)
      await queue.enqueue("post:render", { post_id: post.id }, { dedupeKey: `render:${post.id}` })
      if (b.agenda_auto) await queue.enqueue("agenda:plan", { brand_id: b.id }, { dedupeKey: `agenda:plan:${b.id}:${Math.floor(Date.now() / 300_000)}` })
      log("historia de clima lista para aprobar", { brand: b.slug, dia, tipo, frase })
    }
  }
}

const prevDia = (dia: string) => new Date(Date.parse(`${dia}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

/** Fondo de una historia del sistema: la mejor foto de la marca que no se usó hace poco, o la placa. */
async function fondoHistoria(db: SupabaseClient, queue: Parameters<Handler>[1]["queue"], b: { id: string; slug: string }, semilla: string): Promise<string | null> {
  const { data: fotos } = await db
    .from("cos_assets")
    .select("id, status, current_version_id, traits, quality_score")
    .eq("brand_id", b.id)
    .eq("media_type", "photo")
    .in("status", ["READY", "IN_USE"])
    .neq("consent", "blocked")
    .neq("source", "sistema")
    .or("review_status.is.null,review_status.neq.discarded")
    .gte("quality_score", 70)
    .order("status", { ascending: false })
    .order("quality_score", { ascending: false })
    .limit(10)
  const lista = (fotos ?? []).filter((f) => f.current_version_id)
  // F7 M2: por rasgos si el motor de gustos está habilitado para historias; si no, una de las 5 mejores
  // (estable por campaña: un reintento no cambia el fondo).
  const porGusto = await elegirImagen(db, { brandId: b.id, format: "story", fotos: lista.map((f) => ({ version: f.current_version_id!, traits: f.traits, quality: f.quality_score })), semilla, campania: true })
  if (porGusto) return porGusto.version
  if (lista.length) {
    let h = 0
    for (const ch of semilla) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    return lista[h % Math.min(5, lista.length)].current_version_id
  }
  return placaDeMarca(db, queue, b)
}

// ── brand:hours ────────────────────────────────────────────────────────────

/** Texto visible de una página (sin scripts ni estilos), acotado. */
async function textoDeWeb(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0 (Content OS; horarios)" } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .slice(0, 20_000)
}

function uuidFrom(job: Job, key: string): string {
  const v = job.payload[key]
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/.test(v)) throw new PermanentError(`payload sin ${key} válido`)
  return v
}

/** Webs públicas de cada marca (infra/SERVIDORES.md), por si no están cargadas en Datos vigentes. */
const WEB_MARCA: Record<string, string> = {
  sensaciones: "https://sensacionesdeoriente.com",
  bijutsukan: "https://bijutsukansushi.com",
  fasutofudo: "https://fasutofudo.com",
}

const horariosDeWeb: Handler = async (job, { db, log }) => {
  const brandId = uuidFrom(job, "brand_id")
  const { data: b } = await db.from("cos_brands").select("id, name, slug, datos_vigentes, rules_json").eq("id", brandId).single()
  if (!b) throw new PermanentError("la marca no existe")
  const dv = (b.datos_vigentes ?? {}) as { web?: string; links?: { url?: string }[]; horarios?: string }
  const urls = [...new Set([dv.web, WEB_MARCA[b.slug], ...(dv.links ?? []).map((l) => l.url)].filter((u): u is string => !!u && /^https?:\/\//.test(u)))].slice(0, 3)
  const textos: string[] = []
  const fuentes: string[] = []
  for (const u of urls) {
    try {
      textos.push(`Página ${u}:\n${await textoDeWeb(u)}`)
      fuentes.push(u)
    } catch (e) {
      log("horarios: no se pudo leer la web", { url: u, error: String(e) })
    }
  }
  if (dv.horarios) {
    textos.push(`Horarios cargados en Datos vigentes: ${dv.horarios}`)
    fuentes.push("Datos vigentes")
  }
  const reglas = b.rules_json as { open_days?: string; open_hours?: string } | null
  if (reglas?.open_days || reglas?.open_hours) {
    textos.push(`Días y horas de la configuración vieja: ${reglas.open_days ?? ""} ${reglas.open_hours ?? ""}`)
    fuentes.push("configuración")
  }
  if (!textos.length) {
    await db.from("cos_brands").update({ open_hours_fuente: "No encontré de dónde leerlos: cargá la web en Datos vigentes o escribilos a mano", open_hours_at: new Date().toISOString() }).eq("id", brandId)
    return
  }
  const s = await settings(db)
  const r = await leerHorarios({ db, model: s.ai_model, marca: b.name, textos })
  const propuesta = normalizarApertura(Object.fromEntries(r.dias.map((d) => [String(d.dia), d.turnos])))
  await db
    .from("cos_brands")
    .update({ open_hours_propuesta: propuesta, open_hours_fuente: `${fuentes.join(" · ")}${r.dudas ? ` — ${r.dudas}` : ""}`.slice(0, 500), open_hours_at: new Date().toISOString() })
    .eq("id", brandId)
  log("horarios leídos", { brand: b.name, fuentes, dias: Object.values(propuesta ?? {}).filter((t) => t.length).length })
}

export const agendaHandlers: Record<string, Handler> = {
  "agenda:context": contextoMedia,
  "agenda:learn": aprenderAgenda,
  "agenda:plan": planearAgenda,
  "agenda:replan": replanificarMes,
  "historias:auto": aprobarHistoriasAutomaticas,
  "clima:stories": historiasClima,
  "brand:hours": horariosDeWeb,
}

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
}

async function climaFuturo(db: SupabaseClient): Promise<Map<string, ClimaCat>> {
  const { data } = await db.from("cos_weather_hourly").select("ts, code, temp, precip_mm, precip_prob").gte("ts", new Date().toISOString()).order("ts").limit(400)
  return new Map((data ?? []).map((h) => [new Date(h.ts).toISOString(), climaDeHora(h)]))
}

export async function reglasDeMarca(db: SupabaseClient, brandId: string, clima?: Map<string, ClimaCat>, feriados?: Set<string>): Promise<Reglas> {
  const { data: b } = await db.from("cos_brands").select("open_hours, rules_json").eq("id", brandId).single()
  return {
    desde: new Date(),
    dias: 7,
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
  const pieza: Pieza = { id: p.id, account: p.account_id, format: p.post_type, actual: p.scheduled_at }
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

const planearAgenda: Handler = async (job, { db, log }) => {
  const soloMarca = typeof job.payload.brand_id === "string" ? job.payload.brand_id : null
  const conAgente = job.payload.agente === true
  let q = db.from("cos_brands").select("id, slug, name").eq("active", true).eq("agenda_auto", true)
  if (soloMarca) q = q.eq("id", soloMarca)
  const { data: marcas } = await q
  if (!marcas?.length) return
  const [media, feriados, clima, s] = await Promise.all([cargarMedia(db), cargarFeriados(db), climaFuturo(db), settings(db)])

  for (const b of marcas) {
    const reglas = await reglasDeMarca(db, b.id, clima, feriados)
    const { data: posts, error } = await db
      .from("cos_posts")
      .select("id, account_id, status, post_type, campaign, scheduled_at, window_start, window_end, schedule_lock, schedule_source, schedule_reason, schedule_log, cos_social_accounts(platform)")
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
    const piezas = movibles.filter((p) => !(p.status === "PENDING_APPROVAL" && p.campaign && p.scheduled_at && Date.parse(p.scheduled_at) <= ahora)).map(aPieza)
    const ids = new Set(piezas.map((p) => p.id))
    const ocupados: Ocupado[] = todos
      .filter((p) => !ids.has(p.id) && p.scheduled_at && p.status !== "PENDING_APPROVAL")
      .map((p) => ({ account: p.account_id, format: p.post_type, at: p.scheduled_at! }))
    if (!piezas.length) continue

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

    if (conAgente) {
      // El agente mira el plan del motor con el contexto de la semana y propone ajustes; el código
      // los valida con las mismas reglas. Si la IA falla, queda el plan del motor.
      try {
        const brand = await brandContext(db, b.id)
        const m0 = modeloDe(piezas[0])
        const r = await planearSemana({
          db,
          model: s.ai_model,
          brand,
          plan: plan.map((a) => ({ post_id: a.id, formato: piezas.find((x) => x.id === a.id)!.format, at: a.at, porque: a.porque, fijo: !!piezas.find((x) => x.id === a.id)!.dia })),
          efectos: m0.efectos.filter((e) => e.claro),
          clima: resumenClima(clima),
          fechas: await proximasFechas(db, b.id),
          apertura: reglas.apertura,
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
    if (conAgente || cambios) {
      await db.from("cos_agenda_plans").insert({ brand_id: b.id, plan_json: plan.map((a) => ({ post_id: a.id, at: a.at, porque: a.porque, fuente: a.fuente })), nota, agente })
    }
    log("agenda planeada", { brand: b.slug, piezas: piezas.length, cambios, sinLugar: base.sinLugar.length, agente })
  }
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
      const version = await fondoHistoria(db, queue, b)
      if (!version) {
        log("historia de clima: la placa de fondo se está preparando, sigue en la próxima vuelta", { brand: b.slug })
        continue
      }
      const music = await listMusic(db, b.slug)
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
          music_key: music.length ? music[Math.floor(Math.random() * music.length)] : null,
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
async function fondoHistoria(db: SupabaseClient, queue: Parameters<Handler>[1]["queue"], b: { id: string; slug: string }): Promise<string | null> {
  const { data: fotos } = await db
    .from("cos_assets")
    .select("id, status, current_version_id")
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
  if (lista.length) return lista[Math.floor(Math.random() * Math.min(5, lista.length))].current_version_id
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
  "clima:stories": historiasClima,
  "brand:hours": horariosDeWeb,
}

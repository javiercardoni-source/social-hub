/**
 * content-os-worker — el único proceso que habla con Drive, Meta y la IA (PLAN §3).
 *
 * Ciclo: reclama un trabajo de cos_jobs → lo corre con el manejador de su tipo →
 * lo cierra o lo devuelve a la cola. Mientras corre, renueva el lease cada minuto
 * para que otro worker no lo tome como abandonado.
 *
 * Se corre con Node 24 directo sobre TypeScript (sin compilar): `node worker/src/main.ts`.
 */
import { createServer } from "node:http"
import { hostname } from "node:os"
import { createClient } from "@supabase/supabase-js"
import { createQueue, PermanentError, type Job } from "./queue.ts"
import { handlers } from "./handlers.ts"

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5_000)
const LEASE_RENEW_MS = 60_000 // el lease en la base es de 5 minutos
const SHUTDOWN_GRACE_MS = 25_000
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? 3651)
const WORKER_ID = `${hostname()}:${process.pid}`

function log(msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), worker: WORKER_ID, msg, ...extra }))
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  log("falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY: no arranco")
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const queue = createQueue(db, WORKER_ID)
const shutdown = new AbortController()

// Estado para el chequeo de salud del contenedor.
const state = { startedAt: new Date(), lastLoopAt: null as Date | null, current: null as number | null, lastError: null as string | null }

async function runJob(job: Job) {
  const handler = handlers[job.type]
  if (!handler) {
    await queue.fail(job.id, `no hay manejador para el tipo "${job.type}"`, true)
    log("tipo desconocido", { job: job.id, type: job.type })
    return
  }

  state.current = job.id
  let lost = false
  const renew = setInterval(async () => {
    try {
      if (!(await queue.touch(job.id))) lost = true
    } catch (e) {
      log("no se pudo renovar el lease", { job: job.id, error: String(e) })
    }
  }, LEASE_RENEW_MS)

  const started = Date.now()
  try {
    await handler(job, { db, queue, log, signal: shutdown.signal })
    if (lost) {
      log("terminó, pero el trabajo ya lo había tomado otro worker", { job: job.id })
    } else {
      await queue.complete(job.id)
      log("ok", { job: job.id, type: job.type, ms: Date.now() - started })
    }
  } catch (e) {
    const permanent = e instanceof PermanentError
    const message = e instanceof Error ? e.message : String(e)
    const result = await queue.fail(job.id, message, permanent)
    state.lastError = message
    log("falló", { job: job.id, type: job.type, permanent, result, error: message })
  } finally {
    clearInterval(renew)
    state.current = null
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    shutdown.signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true })
  })

async function loop() {
  const types = Object.keys(handlers)
  log("arrancó", { types })
  while (!shutdown.signal.aborted) {
    state.lastLoopAt = new Date()
    try {
      const [job] = await queue.claim(types, 1)
      if (job) {
        await runJob(job)
        continue // si hubo trabajo, buscar el siguiente sin esperar
      }
    } catch (e) {
      state.lastError = String(e)
      log("error en el ciclo", { error: String(e) })
    }
    await sleep(POLL_MS)
  }
}

// Salud: el contenedor está sano si el ciclo giró hace poco.
const health = createServer((_req, res) => {
  const staleMs = state.lastLoopAt ? Date.now() - state.lastLoopAt.getTime() : Infinity
  const ok = staleMs < POLL_MS * 6 || state.current !== null
  res.writeHead(ok ? 200 : 503, { "content-type": "application/json" })
  res.end(JSON.stringify({ ok, worker: WORKER_ID, ...state }))
})
health.listen(HEALTH_PORT, "0.0.0.0")

// El reloj (cos_scheduler_tick, migración 0003): cada minuto vence, marca perdidos y
// encola publicaciones. Toda la lógica está en la base; acá solo se lo llama.
const TICK_MS = 60_000
async function tick() {
  if (shutdown.signal.aborted) return
  const { data, error } = await db.rpc("cos_scheduler_tick")
  if (error) {
    state.lastError = `reloj: ${error.message}`
    log("el reloj falló", { error: error.message })
    return
  }
  const r = data as Record<string, number | boolean>
  if (r.expired || r.missed || r.publish || r.reconcile) log("reloj", r)
}
void tick()
const clock = setInterval(() => void tick(), TICK_MS)
shutdown.signal.addEventListener("abort", () => clearInterval(clock), { once: true })

// Métricas (F1): cada 2 horas, una sincronización por cuenta. La clave por ventana evita
// encolar dos veces la misma si el worker se reinicia.
const METRICS_MS = 2 * 3600_000
async function scheduleMetrics() {
  if (shutdown.signal.aborted) return
  const { data, error } = await db
    .from("cos_social_accounts")
    .select("id, metrics_synced_at")
    .neq("status", "disabled")
    .in("platform", ["instagram", "facebook"])
  if (error) return log("no pude programar métricas", { error: error.message })
  const window = Math.floor(Date.now() / METRICS_MS)
  // Solo las que no se sincronizaron en las últimas 2 horas (la clave de la cola solo evita
  // duplicados mientras el trabajo está vivo; una vez hecho, esto es lo que frena).
  const due = (data ?? []).filter((a) => !a.metrics_synced_at || Date.now() - new Date(a.metrics_synced_at).getTime() > METRICS_MS - 5 * 60_000)
  for (const a of due) {
    await queue.enqueue("metrics:sync", { account_id: a.id }, { dedupeKey: `metrics:${a.id}:${window}` }).catch((e) => log("no pude encolar métricas", { error: String(e) }))
  }
}
void scheduleMetrics()
const metricsClock = setInterval(() => void scheduleMetrics(), 15 * 60_000)
shutdown.signal.addEventListener("abort", () => clearInterval(metricsClock), { once: true })

// Contexto (F4): feriados, fechas especiales y clima, cada 6 horas.
async function scheduleContext() {
  if (shutdown.signal.aborted) return
  const { data } = await db.from("cos_weather_daily").select("updated_at").order("updated_at", { ascending: false }).limit(1)
  const last = data?.[0]?.updated_at ? new Date(data[0].updated_at).getTime() : 0
  if (Date.now() - last < 6 * 3600_000) return
  await queue
    .enqueue("context:sync", {}, { dedupeKey: `context:${Math.floor(Date.now() / (6 * 3600_000))}` })
    .catch((e) => log("no pude encolar el contexto", { error: String(e) }))
}
void scheduleContext()
const contextClock = setInterval(() => void scheduleContext(), 30 * 60_000)
shutdown.signal.addEventListener("abort", () => clearInterval(contextClock), { once: true })

// Biblioteca de música (F7): el bucket ↔ cos_music_tracks, cada 6 horas (y al arrancar).
// Las subidas desde la web ya registran el tema al momento; esto atrapa lo que suba el script.
async function scheduleMusic() {
  if (shutdown.signal.aborted) return
  // La clave de la cola solo frena duplicados vivos: lo que frena es "ya corrió hace poco".
  const { data } = await db
    .from("cos_jobs")
    .select("id")
    .eq("type", "music:sync")
    .eq("status", "done")
    .gte("finished_at", new Date(Date.now() - 6 * 3600_000).toISOString())
    .limit(1)
  if (data?.length) return
  await queue
    .enqueue("music:sync", {}, { dedupeKey: `music:sync:${Math.floor(Date.now() / (6 * 3600_000))}` })
    .catch((e) => log("no pude encolar la biblioteca de música", { error: String(e) }))
}
void scheduleMusic()
const musicClock = setInterval(() => void scheduleMusic(), 30 * 60_000)
shutdown.signal.addEventListener("abort", () => clearInterval(musicClock), { once: true })

// Agenda (F8). Cada tarea se encola con una clave por ventana de tiempo, y la tarea misma es
// idempotente (si corre de más no rompe nada; solo cuesta un poco de cómputo):
//   agenda:plan     cada hora (sin IA); el agente (IA) una vez por día, a las 7 de Buenos Aires
//   clima:stories   cada 3 horas
//   agenda:learn    una vez por día
//   agenda:context  una vez por día (clima histórico y feriados de lo publicado)
function agendaClock() {
  if (shutdown.signal.aborted) return
  const ahora = Date.now()
  const horaBA = new Date(ahora - 3 * 3600_000).getUTCHours()
  const hora = Math.floor(ahora / 3600_000)
  const dia = Math.floor((ahora - 3 * 3600_000) / 86_400_000)
  const pedir = (tipo: string, payload: Record<string, unknown>, clave: string, runAt?: Date) =>
    queue.enqueue(tipo, payload, { dedupeKey: clave, runAt }).catch((e) => log(`no pude encolar ${tipo}`, { error: String(e) }))
  // La agenda va adelante en la cola: si espera detrás de los videos, propone horas viejas.
  void pedir("agenda:plan", { agente: horaBA === 7 }, `agenda:plan:${hora}`, new Date(ahora - 3600_000))
  // Música: un set chico por marca, cada hora, hasta que no quede nada con la biblioteca vieja
  // (shared/cos/musica-actualizar.ts). Sin condición: si no hay nada que actualizar, no hace nada.
  void pedir("music:actualizar", {}, `music:actualizar:${hora}`)
  // Ingredientes: controla los textos de las piezas pendientes que todavía no pasaron por el control
  // (worker/src/ingredientes-revisar.ts). Sin condición: si no queda ninguna, no hace nada.
  void pedir("ingredientes:revisar", {}, `ingredientes:revisar:${hora}`)
  // Historias automáticas (clima, feriado): se aprueban solas en cuanto su pieza está lista (worker/src/agenda.ts).
  void pedir("historias:auto", {}, `historias:auto:${hora}`)
  if (hora % 3 === 0) void pedir("clima:stories", {}, `clima:stories:${hora}`)
  if (horaBA === 5) {
    void pedir("agenda:context", {}, `agenda:context:${dia}`)
    void pedir("agenda:learn", {}, `agenda:learn:${dia}`)
    void pedir("taste:learn", {}, `taste:learn:${dia}`)
  }
  // Sugerencias de la semana (F7 M3): los lunes a las 6, después de aprender. El job es idempotente por semana.
  if (horaBA === 6 && new Date(ahora - 3 * 3600_000).getUTCDay() === 1) {
    void pedir("taste:suggest", {}, `taste:suggest:${dia}`)
  }
}
// Al arrancar: contexto y modelo si nunca se hicieron (una sola vez por día).
void queue.enqueue("agenda:context", {}, { dedupeKey: `agenda:context:boot:${Math.floor(Date.now() / 86_400_000)}` }).catch(() => {})
// Primer tic al comienzo de la próxima hora; después, cada hora.
const alaHora = 3600_000 - (Date.now() % 3600_000) + 30_000
const agendaStart = setTimeout(() => {
  agendaClock()
  const t = setInterval(agendaClock, 3600_000)
  shutdown.signal.addEventListener("abort", () => clearInterval(t), { once: true })
}, alaHora)
shutdown.signal.addEventListener("abort", () => clearTimeout(agendaStart), { once: true })

// Motor de ADS (F10, docs/PLAN-MOTOR-ADS.md): solo si está el token de anuncios (META_ADS_TOKEN).
//   ads:sync   todos los días a las 4 de Buenos Aires, una corrida por cuenta (se parte sola por mes)
//   ads:batch  la tanda de la semana, los lunes a las 7 (después de las sugerencias de las 6)
// Al arrancar, las cuentas que nunca se leyeron arrancan su backfill (desde dic-2025).
import("./ads.ts").then(({ adsConfig }) => {
  if (!adsConfig()) return log("Motor de ADS apagado (falta META_ADS_TOKEN)")
  const pedir = (tipo: string, payload: Record<string, unknown>, clave: string) =>
    queue.enqueue(tipo, payload, { dedupeKey: clave }).catch((e) => log(`no pude encolar ${tipo}`, { error: String(e) }))
  async function cuentas(soloNuevas: boolean) {
    let q = db.from("cos_ad_accounts").select("id").eq("active", true)
    if (soloNuevas) q = q.is("insights_until", null)
    const { data, error } = await q
    if (error) return log("no pude leer las cuentas de anuncios", { error: error.message })
    const dia = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
    for (const c of data ?? []) await pedir("ads:sync", { account_id: c.id }, `ads:sync:${c.id}:inicio:${dia}`)
  }
  void cuentas(true)
  const reloj = () => {
    const ahora = new Date(Date.now() - 3 * 3600_000)
    const dia = ahora.toISOString().slice(0, 10)
    if (ahora.getUTCHours() === 4) void cuentas(false)
    if (ahora.getUTCHours() === 7 && ahora.getUTCDay() === 1) void pedir("ads:batch", {}, `ads:batch:${dia}`)
  }
  const t = setInterval(reloj, 3600_000)
  shutdown.signal.addEventListener("abort", () => clearInterval(t), { once: true })
})

// Historias de Turnos "para redes" (F3): cada 3 minutos, solo si está configurado.
import("./turnos.ts").then(({ turnosConfig }) => {
  if (!turnosConfig()) return log("Turnos no configurado (TURNOS_API_URL / CONTENT_OS_SECRET): historias apagadas")
  const tick = () =>
    queue
      .enqueue("ingest:turnos", {}, { dedupeKey: `turnos:${Math.floor(Date.now() / 180_000)}` })
      .catch((e) => log("no pude encolar Turnos", { error: String(e) }))
  void tick()
  const t = setInterval(() => void tick(), 180_000)
  shutdown.signal.addEventListener("abort", () => clearInterval(t), { once: true })
})

// Material del Programa Embajadores (LoyalEngine, F4B): cada 3 minutos, solo si está
// configurado. Apagado sin error si faltan LOYAL_API_URL / CONTENT_OS_SECRET_LOYAL.
import("./embajadores.ts").then(({ embajadoresConfig }) => {
  if (!embajadoresConfig()) return log("LoyalEngine no configurado (LOYAL_API_URL / CONTENT_OS_SECRET_LOYAL): embajadores apagado")
  const tick = () =>
    queue
      .enqueue("ingest:embajadores", {}, { dedupeKey: `embajadores:${Math.floor(Date.now() / 180_000)}` })
      .catch((e) => log("no pude encolar Embajadores", { error: String(e) }))
  void tick()
  const t = setInterval(() => void tick(), 180_000)
  shutdown.signal.addEventListener("abort", () => clearInterval(t), { once: true })
})

const done = loop()

async function stop(signal: string) {
  if (shutdown.signal.aborted) return
  log("apagando", { signal, current: state.current })
  shutdown.abort()
  const timeout = new Promise((r) => setTimeout(r, SHUTDOWN_GRACE_MS))
  await Promise.race([done, timeout])
  health.close()
  process.exit(0)
}
process.on("SIGTERM", () => void stop("SIGTERM"))
process.on("SIGINT", () => void stop("SIGINT"))

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

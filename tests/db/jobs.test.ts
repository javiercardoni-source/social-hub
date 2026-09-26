/**
 * La cola de trabajos (PLAN §3, §6): sin duplicados, reintentos con espera creciente
 * y recuperación cuando un worker muere a mitad de camino.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { type Db, freshDb, one } from "./harness"

let db: Db
beforeEach(async () => {
  db = await freshDb()
})

type Job = { id: number; type: string; status: string; attempts: number; locked_by: string | null }

const enqueue = async (type: string, dedupe: string | null = null, runAt = "now()") =>
  (await one<{ id: number }>(db, `select cos_enqueue_job($1, '{}'::jsonb, ${runAt}, $2) as id`, [type, dedupe])).id
const claim = async (worker: string, types: string[] | null = null, limit = 1) =>
  (await db.query<Job>(`select * from cos_claim_jobs($1, $2, $3)`, [worker, types, limit])).rows
const job = (id: number) =>
  one<Job & { run_at: string; secs: number; last_error: string | null }>(
    db,
    `select *, extract(epoch from (run_at - now()))::int as secs from cos_jobs where id = $1`,
    [id],
  )

describe("sin duplicados", () => {
  it("encolar dos veces la misma publicación devuelve el mismo trabajo", async () => {
    const a = await enqueue("publish", "publish:post-1")
    const b = await enqueue("publish", "publish:post-1")
    expect(b).toBe(a)
    expect((await one<{ n: number }>(db, `select count(*)::int as n from cos_jobs`)).n).toBe(1)
  })

  it("mientras está corriendo tampoco se duplica", async () => {
    const a = await enqueue("publish", "publish:post-1")
    await claim("w1")
    expect(await enqueue("publish", "publish:post-1")).toBe(a)
  })

  it("una vez terminado, se puede volver a encolar (p. ej. republicar a propósito)", async () => {
    const a = await enqueue("publish", "publish:post-1")
    await claim("w1")
    await db.query(`select cos_complete_job($1, 'w1')`, [a])
    expect(await enqueue("publish", "publish:post-1")).not.toBe(a)
  })

  it("dos reclamos seguidos no se llevan el mismo trabajo", async () => {
    await enqueue("a")
    await enqueue("b")
    const [x] = await claim("w1")
    const [y] = await claim("w2")
    expect(x.id).not.toBe(y.id)
    expect(await claim("w3")).toHaveLength(0)
  })
})

describe("reclamar", () => {
  it("solo trabajos vencidos y del tipo pedido; suma un intento", async () => {
    await enqueue("futuro", null, "now() + interval '1 hour'")
    const ingest = await enqueue("ingest:turnos")
    await enqueue("publish")
    const got = await claim("w1", ["ingest:turnos"], 10)
    expect(got.map((j) => j.id)).toEqual([ingest])
    expect(got[0]).toMatchObject({ status: "running", attempts: 1, locked_by: "w1" })
  })
})

describe("terminar y fallar", () => {
  it("solo quien lo tomó lo puede cerrar", async () => {
    const id = await enqueue("x")
    await claim("w1")
    expect((await one<{ ok: boolean }>(db, `select cos_complete_job($1, 'otro') as ok`, [id])).ok).toBe(false)
    expect((await one<{ ok: boolean }>(db, `select cos_complete_job($1, 'w1') as ok`, [id])).ok).toBe(true)
    expect((await job(id)).status).toBe("done")
  })

  it("falla y reintenta con espera creciente: 30 s, 60 s, 120 s…", async () => {
    const id = await enqueue("x")
    const esperas: number[] = []
    for (let i = 0; i < 3; i++) {
      await db.query(`update cos_jobs set run_at = now() where id = $1`, [id])
      await claim("w1")
      const r = await one<{ r: string }>(db, `select cos_fail_job($1, 'w1', 'Meta respondió 500') as r`, [id])
      expect(r.r).toBe("retry")
      esperas.push((await job(id)).secs)
    }
    expect(esperas[0]).toBeGreaterThanOrEqual(29)
    expect(esperas[0]).toBeLessThanOrEqual(30)
    expect(esperas[1]).toBeGreaterThanOrEqual(59)
    expect(esperas[2]).toBeGreaterThanOrEqual(119)
    expect((await job(id)).last_error).toBe("Meta respondió 500")
  })

  it("al agotar los intentos queda fallido", async () => {
    const id = (await one<{ id: number }>(db, `select cos_enqueue_job('x', '{}', now(), null, 2) as id`)).id
    await claim("w1")
    await db.query(`select cos_fail_job($1, 'w1', 'error 1')`, [id])
    await db.query(`update cos_jobs set run_at = now() where id = $1`, [id])
    await claim("w1")
    const r = await one<{ r: string }>(db, `select cos_fail_job($1, 'w1', 'error 2') as r`, [id])
    expect(r.r).toBe("failed")
    expect((await job(id)).status).toBe("failed")
  })

  it("un error permanente (token inválido) no se reintenta", async () => {
    const id = await enqueue("x")
    await claim("w1")
    const r = await one<{ r: string }>(db, `select cos_fail_job($1, 'w1', 'token inválido', null, true) as r`, [id])
    expect(r.r).toBe("failed")
  })
})

describe("worker caído a mitad de camino", () => {
  it("otro worker lo retoma cuando vence el lease, y el viejo ya no lo puede cerrar", async () => {
    const id = await enqueue("publish", "publish:post-1")
    await claim("w1")
    // Simula que w1 murió hace 10 minutos.
    await db.query(`update cos_jobs set locked_at = now() - interval '10 minutes' where id = $1`, [id])
    const [retomado] = await claim("w2")
    expect(retomado).toMatchObject({ id, locked_by: "w2", attempts: 2 })
    expect((await one<{ ok: boolean }>(db, `select cos_complete_job($1, 'w1') as ok`, [id])).ok).toBe(false)
    expect((await one<{ r: string }>(db, `select cos_fail_job($1, 'w1', 'x') as r`, [id])).r).toBe("not_owner")
  })

  it("renovar el lease evita que otro lo robe", async () => {
    const id = await enqueue("x")
    await claim("w1")
    await db.query(`update cos_jobs set locked_at = now() - interval '10 minutes' where id = $1`, [id])
    expect((await one<{ ok: boolean }>(db, `select cos_touch_job($1, 'w1') as ok`, [id])).ok).toBe(true)
    expect(await claim("w2")).toHaveLength(0)
  })

  it("si murió y ya no le quedaban intentos, queda fallido en vez de correr de nuevo", async () => {
    const id = (await one<{ id: number }>(db, `select cos_enqueue_job('x', '{}', now(), null, 1) as id`)).id
    await claim("w1")
    await db.query(`update cos_jobs set locked_at = now() - interval '10 minutes' where id = $1`, [id])
    expect(await claim("w2")).toHaveLength(0)
    expect((await job(id)).status).toBe("failed")
  })
})

/**
 * F4B — ingest:embajadores (docs/embajadores/CONTRATO-CONTENT-OS.md).
 *
 * Nada de base real ni de Supabase real: una base falsa en memoria (alcanza con las
 * pocas consultas que usa embajadores.ts) y un servidor HTTP local de juguete que hace
 * de LoyalEngine. Así se prueba el circuito completo (pending → descarga → asset →
 * ack → puntaje) sin tocar nada de verdad.
 */
import { execFile, execFileSync } from "node:child_process"
import { createServer, type Server } from "node:http"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { calcularBitrateObjetivo, embajadoresConfig, ingestEmbajadores } from "../../worker/src/embajadores.ts"
import type { Queue } from "../../worker/src/queue.ts"

const run = promisify(execFile)

// ¿Hay ffmpeg en esta máquina? Se chequea una sola vez, al cargar el archivo (los tests
// con .skipIf necesitan la condición ya resuelta, no una promesa). Sin ffmpeg, el único
// test que arma un video real se saltea; el resto no lo necesita (fallan más arriba).
const FFMPEG_AVAILABLE = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()

// ── Base falsa ────────────────────────────────────────────────────────────────
// Imita lo mínimo del query builder de supabase-js que usa embajadores.ts: encadena
// .select/.eq/.not/.is y termina en .maybeSingle()/.single() o, sin eso, es "thenable"
// (así funcionan los `await db.from(...).update(...).eq(...)` sin .select()).
type Row = Record<string, unknown>

function fakeDb(opts: { brands: Row[]; assets?: Row[]; uploadError?: string | null }) {
  const tables: Record<string, Row[]> = { cos_brands: opts.brands, cos_assets: opts.assets ?? [] }
  let nextId = 1
  const uploads: { key: string; contentType: string }[] = []

  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = []
    let insertPayload: Row | null = null
    let updatePayload: Row | null = null
    const api = {
      select: () => api,
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val)
        return api
      },
      is(col: string, val: unknown) {
        filters.push((r) => (val === null ? r[col] == null : r[col] === val))
        return api
      },
      not(col: string, op: string, val: unknown) {
        if (op === "is" && val === null) filters.push((r) => r[col] != null)
        return api
      },
      insert(payload: Row) {
        insertPayload = payload
        return api
      },
      update(payload: Row) {
        updatePayload = payload
        return api
      },
      async maybeSingle() {
        const rows = tables[table].filter((r) => filters.every((f) => f(r)))
        return { data: rows[0] ?? null, error: null }
      },
      async single() {
        if (insertPayload) {
          const row = { id: `asset-${nextId++}`, ...insertPayload }
          tables[table].push(row)
          return { data: { id: row.id }, error: null }
        }
        const rows = tables[table].filter((r) => filters.every((f) => f(r)))
        return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: "no encontrado" } }
      },
      // Se usa sin .single() ni .maybeSingle(): el sweep (select de varias filas) y los
      // update(...).eq(...) sueltos (como en turnos.ts / handlers.ts).
      then(resolve: (v: { data: unknown; error: null }) => unknown, reject?: (e: unknown) => unknown) {
        try {
          if (updatePayload) {
            for (const r of tables[table]) if (filters.every((f) => f(r))) Object.assign(r, updatePayload)
            return resolve({ data: null, error: null })
          }
          const rows = tables[table].filter((r) => filters.every((f) => f(r)))
          return resolve({ data: rows, error: null })
        } catch (e) {
          return reject ? reject(e) : undefined
        }
      },
    }
    return api
  }

  const db = {
    from: builder,
    storage: {
      from: () => ({
        async upload(key: string, _data: unknown, options: { contentType: string }) {
          uploads.push({ key, contentType: options.contentType })
          if (opts.uploadError) return { error: { message: opts.uploadError } }
          return { error: null }
        },
      }),
    },
  }
  return { db, tables, uploads }
}

function fakeQueue() {
  const enqueued: { type: string; payload: Record<string, unknown>; dedupeKey?: string }[] = []
  const queue = {
    enqueue: vi.fn(async (type: string, payload: Record<string, unknown>, opts: { dedupeKey?: string } = {}) => {
      enqueued.push({ type, payload, dedupeKey: opts.dedupeKey })
      return { id: enqueued.length }
    }),
  }
  return { queue: queue as unknown as Queue, enqueued }
}

function collectLog() {
  const lines: { msg: string; extra?: Record<string, unknown> }[] = []
  const log = (msg: string, extra?: Record<string, unknown>) => lines.push({ msg, extra })
  return { log, lines }
}

// ── LoyalEngine de juguete ──────────────────────────────────────────────────
const SECRET = "test-secret-loyal"

type LoyalState = {
  items: Record<string, unknown>[]
  ackStatus: number | ((body: { id: string; cos_asset_id: string }) => number)
  scoreOk: boolean
  acked: { id: string; cos_asset_id: string }[]
  scored: { id: string; quality_score: number }[]
  // El archivo del download_url: por default un cuerpo chico de juguete (sirve para el
  // camino liviano, que no mira el contenido). Los tests del video pesado lo pisan.
  fileStatus: number
  fileBody: Buffer
  fileHits: number
}

function startLoyal(state: LoyalState): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
      // El download_url (el archivo en sí) NO lleva header, como en LoyalEngine real:
      // va firmado con HMAC en la propia URL (exp/sig). El resto sí exige el secreto.
      if (req.method === "GET" && req.url?.startsWith("/file/")) {
        state.fileHits++
        if (state.fileStatus !== 200) {
          res.writeHead(state.fileStatus).end()
          return
        }
        res.writeHead(200, { "content-type": "video/mp4" }).end(state.fileBody)
        return
      }
      const secretOk = req.headers["x-content-os-secret"] === SECRET
      if (!secretOk) {
        res.writeHead(401).end()
        return
      }
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null
      if (req.method === "GET" && req.url?.startsWith("/api/integrations/content/pending")) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ items: state.items }))
        return
      }
      if (req.method === "POST" && req.url === "/api/integrations/content/ack") {
        const status = typeof state.ackStatus === "function" ? state.ackStatus(body) : state.ackStatus
        if (status === 200) state.acked.push(body)
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ ok: status === 200 }))
        return
      }
      if (req.method === "POST" && req.url === "/api/integrations/content/score") {
        if (state.scoreOk) state.scored.push(body)
        res.writeHead(state.scoreOk ? 200 : 500, { "content-type": "application/json" }).end(JSON.stringify({ ok: state.scoreOk }))
        return
      }
      res.writeHead(404).end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

const ORIGINAL_ENV = { ...process.env }

describe("ingest:embajadores", () => {
  let server: Server
  let url: string
  let state: LoyalState

  beforeEach(async () => {
    state = { items: [], ackStatus: 200, scoreOk: true, acked: [], scored: [], fileStatus: 200, fileBody: Buffer.from("contenido-de-prueba"), fileHits: 0 }
    const started = await startLoyal(state)
    server = started.server
    url = started.url
    process.env.LOYAL_API_URL = url
    process.env.CONTENT_OS_SECRET_LOYAL = SECRET
  })

  afterEach(() => {
    server.close()
    process.env = { ...ORIGINAL_ENV }
  })

  it("sin LOYAL_API_URL o CONTENT_OS_SECRET_LOYAL, no hace nada (apagado sin error)", async () => {
    delete process.env.LOYAL_API_URL
    expect(embajadoresConfig()).toBeNull()
    const { db } = fakeDb({ brands: [] })
    const { queue, enqueued } = fakeQueue()
    const { log } = collectLog()
    const r = await ingestEmbajadores(db as never, queue, log)
    expect(r).toEqual({ tomadas: 0, puntuadas: 0 })
    expect(enqueued).toHaveLength(0)
  })

  it("trae un pendiente liviano (≤45 MB), lo sube tal cual, crea el asset (con permiso ya dado) y lo ackea", async () => {
    state.items = [
      {
        id: "sub-1",
        kind: "video",
        brand_slug: "fasutofudo",
        submitted_by: "@martu (embajador)",
        description: "Material de @martu (embajador) · IMG_4821.MOV",
        mime: "video/quicktime",
        size_bytes: 2_000_000, // chico: no pasa por ffmpeg, va por el camino liviano
        created_at: "2026-09-30T18:20:00Z",
        download_url: `${url}/file/sub-1`,
        image_rights_ok: true,
      },
    ]
    const { db, tables, uploads } = fakeDb({ brands: [{ id: "brand-fasu", slug: "fasutofudo", active: true }] })
    const { queue, enqueued } = fakeQueue()
    const { log } = collectLog()

    const r = await ingestEmbajadores(db as never, queue, log)

    expect(r.tomadas).toBe(1)
    expect(uploads).toHaveLength(1)
    expect(uploads[0].key).toBe("originals/fasutofudo/embajadores/sub-1.mov")
    expect(uploads[0].contentType).toBe("video/quicktime")

    expect(tables.cos_assets).toHaveLength(1)
    const asset = tables.cos_assets[0]
    expect(asset.source).toBe("embajadores")
    expect(asset.source_external_id).toBe("amb:sub-1")
    expect(asset.brand_id).toBe("brand-fasu")
    expect(asset.consent).toBe("ok") // el permiso ya vino dado de LoyalEngine
    expect(asset.review_status).toBe("approved") // pre-aprobado: arma el borrador solo
    expect(asset.submitted_by_label).toBe("@martu (embajador)")
    expect(asset.size_bytes).toBe(2_000_000)

    expect(enqueued).toEqual([{ type: "asset:process", payload: { asset_id: asset.id }, dedupeKey: `process:${asset.id}` }])
    expect(state.acked).toEqual([{ id: "sub-1", cos_asset_id: asset.id }])
  })

  it("una marca que Content OS no maneja: se saltea, no ackea y avisa", async () => {
    state.items = [
      {
        id: "sub-2",
        kind: "foto",
        brand_slug: "marca-inexistente",
        submitted_by: "(fan)",
        description: "una descripción de más de quince caracteres",
        mime: "image/jpeg",
        size_bytes: 1000,
        created_at: "2026-09-30T18:20:00Z",
        download_url: `${url}/file/sub-2`,
        image_rights_ok: true,
      },
    ]
    const { db, tables } = fakeDb({ brands: [{ id: "brand-fasu", slug: "fasutofudo", active: true }] })
    const { queue } = fakeQueue()
    const { log, lines } = collectLog()

    const r = await ingestEmbajadores(db as never, queue, log)

    expect(r.tomadas).toBe(0)
    expect(tables.cos_assets).toHaveLength(0)
    expect(state.acked).toHaveLength(0)
    expect(lines.some((l) => /marca que Content OS no maneja/.test(l.msg))).toBe(true)
  })

  it("idempotencia: si el asset ya existe (se cortó antes del ack), no baja de nuevo y reintenta el ack", async () => {
    state.items = [
      {
        id: "sub-3",
        kind: "foto",
        brand_slug: "fasutofudo",
        submitted_by: "@martu (embajador)",
        description: "una descripción de más de quince caracteres",
        mime: "image/jpeg",
        size_bytes: 500,
        created_at: "2026-09-30T18:20:00Z",
        download_url: `${url}/file/sub-3`,
        image_rights_ok: true,
      },
    ]
    const { db, uploads } = fakeDb({
      brands: [{ id: "brand-fasu", slug: "fasutofudo", active: true }],
      assets: [{ id: "asset-ya-existe", source: "embajadores", source_external_id: "amb:sub-3" }],
    })
    const { queue, enqueued } = fakeQueue()
    const { log } = collectLog()

    const r = await ingestEmbajadores(db as never, queue, log)

    expect(r.tomadas).toBe(1)
    expect(uploads).toHaveLength(0) // no se vuelve a bajar ni a subir
    expect(enqueued).toHaveLength(0) // no se vuelve a encolar asset:process
    expect(state.acked).toEqual([{ id: "sub-3", cos_asset_id: "asset-ya-existe" }])
  })

  it("ack 409 (ya ackeado con otro asset): se avisa y no se reintenta en el mismo ciclo", async () => {
    state.items = [
      {
        id: "sub-4",
        kind: "foto",
        brand_slug: "fasutofudo",
        submitted_by: "(fan)",
        description: "una descripción de más de quince caracteres",
        mime: "image/jpeg",
        size_bytes: 500,
        created_at: "2026-09-30T18:20:00Z",
        download_url: `${url}/file/sub-4`,
        image_rights_ok: true,
      },
    ]
    state.ackStatus = 409
    const { db } = fakeDb({ brands: [{ id: "brand-fasu", slug: "fasutofudo", active: true }] })
    const { queue } = fakeQueue()
    const { log, lines } = collectLog()

    const r = await ingestEmbajadores(db as never, queue, log)

    expect(r.tomadas).toBe(0) // no cuenta como tomado
    expect(lines.some((l) => /ya estaba ackeado.*otro asset/.test(l.msg))).toBe(true)
  })

  it("después de clasificar: avisa el quality_score a LoyalEngine y marca embajador_scored_at", async () => {
    const { db, tables } = fakeDb({
      brands: [],
      assets: [
        { id: "asset-clasificado", source: "embajadores", source_external_id: "amb:sub-5", quality_score: 82, embajador_scored_at: null },
        // Ya puntuado antes: no se le vuelve a avisar.
        { id: "asset-ya-puntuado", source: "embajadores", source_external_id: "amb:sub-6", quality_score: 40, embajador_scored_at: "2026-09-29T00:00:00Z" },
      ],
    })
    const { queue } = fakeQueue()
    const { log } = collectLog()

    const r = await ingestEmbajadores(db as never, queue, log)

    expect(r.puntuadas).toBe(1)
    expect(state.scored).toEqual([{ id: "sub-5", quality_score: 82 }])
    expect(tables.cos_assets.find((a) => a.id === "asset-clasificado")?.embajador_scored_at).not.toBeNull()
    expect(tables.cos_assets.find((a) => a.id === "asset-ya-puntuado")?.embajador_scored_at).toBe("2026-09-29T00:00:00Z")
  })

  it("si LoyalEngine no acepta el puntaje, no marca embajador_scored_at (reintenta el próximo ciclo)", async () => {
    state.scoreOk = false
    const { db, tables } = fakeDb({
      brands: [],
      assets: [{ id: "asset-falla", source: "embajadores", source_external_id: "amb:sub-7", quality_score: 55, embajador_scored_at: null }],
    })
    const { queue } = fakeQueue()
    const { log, lines } = collectLog()

    const r = await ingestEmbajadores(db as never, queue, log)

    expect(r.puntuadas).toBe(0)
    expect(tables.cos_assets[0].embajador_scored_at).toBeNull()
    expect(lines.some((l) => /no se pudo avisar el puntaje/.test(l.msg))).toBe(true)
  })

  // ── Videos pesados: transcodifica antes de subir (verificado a mano: el proyecto de
  // Supabase corta en 50 MB) ──────────────────────────────────────────────────────────
  describe("video pesado (>45 MB o sin tamaño declarado)", () => {
    let tmpDir: string
    let videoChico: Buffer

    beforeAll(async () => {
      if (!FFMPEG_AVAILABLE) return
      tmpDir = await mkdtemp(join(tmpdir(), "cos-test-embajador-"))
      const out = join(tmpDir, "chico.mp4")
      // Un video real de 1 segundo, chiquito: alcanza para probar que ffmpeg corre de
      // verdad y produce un mp4 válido, sin pesar los tests con archivos grandes.
      await run("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=1",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-t", "1", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
        out,
      ])
      videoChico = await readFile(out)
    })

    afterAll(async () => {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
    })

    it.skipIf(!FFMPEG_AVAILABLE)("video sin tamaño declarado: se baja a disco, se transcodifica a mp4 y se sube desde ahí", async () => {
      state.fileBody = videoChico
      state.items = [
        {
          id: "sub-8",
          kind: "video",
          brand_slug: "fasutofudo",
          submitted_by: "@martu (embajador)",
          description: "un video sin tamaño declarado por LoyalEngine",
          mime: "video/mp4",
          size_bytes: null,
          created_at: "2026-09-30T18:20:00Z",
          download_url: `${url}/file/sub-8`,
          image_rights_ok: true,
        },
      ]
      const { db, tables, uploads } = fakeDb({ brands: [{ id: "brand-fasu", slug: "fasutofudo", active: true }] })
      const { queue } = fakeQueue()
      const { log } = collectLog()

      const r = await ingestEmbajadores(db as never, queue, log)

      expect(r.tomadas).toBe(1)
      expect(uploads).toHaveLength(1)
      expect(uploads[0].key).toBe("originals/fasutofudo/embajadores/sub-8.mp4")
      expect(uploads[0].contentType).toBe("video/mp4")
      const asset = tables.cos_assets[0]
      expect(asset.mime).toBe("video/mp4")
      expect(asset.size_bytes).toBeGreaterThan(0)
      expect(state.acked).toEqual([{ id: "sub-8", cos_asset_id: asset.id }])
    })

    it("una foto grande declarada (>45 MB) NO pasa por ffmpeg: solo se transcodifican videos", async () => {
      state.items = [
        {
          id: "sub-9",
          kind: "foto",
          brand_slug: "fasutofudo",
          submitted_by: "(fan)",
          description: "una foto rarísima de más de 45 MB (HEIC de alta resolución)",
          mime: "image/heic",
          size_bytes: 60 * 1024 * 1024,
          created_at: "2026-09-30T18:20:00Z",
          download_url: `${url}/file/sub-9`,
          image_rights_ok: true,
        },
      ]
      const { db, tables, uploads } = fakeDb({ brands: [{ id: "brand-fasu", slug: "fasutofudo", active: true }] })
      const { queue } = fakeQueue()
      const { log } = collectLog()

      const r = await ingestEmbajadores(db as never, queue, log)

      expect(r.tomadas).toBe(1)
      expect(uploads[0].key).toBe("originals/fasutofudo/embajadores/sub-9.heic") // extensión original: no se tocó
      expect(uploads[0].contentType).toBe("image/heic")
      expect(tables.cos_assets[0].size_bytes).toBe(60 * 1024 * 1024)
    })

    it("si no se puede bajar el video, reintenta hasta 3 veces y después se rinde sin loopear para siempre", async () => {
      state.fileStatus = 500
      state.items = [
        {
          id: "sub-10",
          kind: "video",
          brand_slug: "fasutofudo",
          submitted_by: "@martu (embajador)",
          description: "un video que nunca se puede bajar",
          mime: "video/mp4",
          size_bytes: null,
          created_at: "2026-09-30T18:20:00Z",
          download_url: `${url}/file/sub-10`,
          image_rights_ok: true,
        },
      ]
      const { db, tables } = fakeDb({ brands: [{ id: "brand-fasu", slug: "fasutofudo", active: true }] })
      const { queue } = fakeQueue()

      // 4 ciclos seguidos (como si el worker los corriera cada 3 min): al 4to ya se rindió
      // y ni siquiera vuelve a pedirle el archivo a LoyalEngine.
      for (let ciclo = 1; ciclo <= 4; ciclo++) {
        const { log, lines } = collectLog()
        const r = await ingestEmbajadores(db as never, queue, log)
        expect(r.tomadas).toBe(0)
        if (ciclo <= 3) {
          expect(lines.some((l) => /no se pudo bajar\/comprimir/.test(l.msg))).toBe(true)
        } else {
          expect(lines.some((l) => /no entra ni comprimido después de varios intentos/.test(l.msg))).toBe(true)
        }
      }

      expect(state.fileHits).toBe(3) // el 4to ciclo no vuelve a intentar la descarga
      expect(tables.cos_assets).toHaveLength(0)
      expect(state.acked).toHaveLength(0)
    })

    it("un archivo que no es un video de verdad (corrupto) cuenta como intento fallido", async () => {
      state.fileBody = Buffer.from("esto no es ningún video, es texto plano")
      state.items = [
        {
          id: "sub-11",
          kind: "video",
          brand_slug: "fasutofudo",
          submitted_by: "(fan)",
          description: "un archivo roto",
          mime: "video/mp4",
          size_bytes: null,
          created_at: "2026-09-30T18:20:00Z",
          download_url: `${url}/file/sub-11`,
          image_rights_ok: true,
        },
      ]
      const { db } = fakeDb({ brands: [{ id: "brand-fasu", slug: "fasutofudo", active: true }] })
      const { queue } = fakeQueue()
      const { log, lines } = collectLog()

      const r = await ingestEmbajadores(db as never, queue, log)

      expect(r.tomadas).toBe(0)
      expect(state.fileHits).toBe(1) // sí se bajó, pero ffprobe no le encontró video
      expect(lines.some((l) => /no se pudo bajar\/comprimir/.test(l.msg))).toBe(true)
    })
  })
})

describe("calcularBitrateObjetivo", () => {
  it("un video largo pide menos bitrate que uno corto, para el mismo tamaño objetivo", () => {
    const bLargo = calcularBitrateObjetivo(10 * 60_000, 44 * 1024 * 1024, 96)
    const bCorto = calcularBitrateObjetivo(10_000, 44 * 1024 * 1024, 96)
    expect(bCorto).toBeGreaterThan(bLargo)
  })

  it("nunca baja del piso de 300 kbps, ni con videos larguísimos", () => {
    expect(calcularBitrateObjetivo(2 * 3600_000, 44 * 1024 * 1024, 96)).toBe(300)
  })

  it("sin duración conocida, no explota (usa 1 segundo como mínimo)", () => {
    expect(calcularBitrateObjetivo(null, 44 * 1024 * 1024, 96)).toBeGreaterThan(0)
  })
})

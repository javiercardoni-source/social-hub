/**
 * Google Drive de Content OS (PLAN §8): cuenta javiercardonibetti@gmail.com por OAuth,
 * permiso drive.file (solo ve lo que crea el propio sistema). Lo conecta el script
 * scripts/drive-conectar.py; acá se usa la llave permanente (refresh token).
 *
 * Estructura: Content OS/10_ORIGINALS/<marca>/<AAAA-MM>/…  Nunca se borra nada.
 */
import { PermanentError } from "./queue.ts"

const API = "https://www.googleapis.com/drive/v3"
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
const FOLDER = "application/vnd.google-apps.folder"

export type Drive = ReturnType<typeof createDrive>

/** null si faltan las variables: el sistema sigue andando, solo que sin archivar en Drive. */
export function driveFromEnv(): Drive | null {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN
  const rootId = process.env.GOOGLE_DRIVE_ROOT_ID
  if (!clientId || !clientSecret || !refreshToken || !rootId) return null
  return createDrive({ clientId, clientSecret, refreshToken, rootId })
}

function createDrive(cfg: { clientId: string; clientSecret: string; refreshToken: string; rootId: string }) {
  let token: { value: string; until: number } | null = null
  const folderCache = new Map<string, string>()

  async function accessToken(): Promise<string> {
    if (token && token.until > Date.now() + 60_000) return token.value
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
        grant_type: "refresh_token",
      }),
    })
    const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string }
    if (!res.ok || !body.access_token) {
      // invalid_grant = se revocó el acceso: hay que volver a correr drive-conectar.py.
      const msg = `Drive: no pude renovar el acceso (${body.error ?? res.status})`
      throw body.error === "invalid_grant" ? new PermanentError(`${msg}. Correr scripts/drive-conectar.py`) : new Error(msg)
    }
    token = { value: body.access_token, until: Date.now() + (body.expires_in ?? 3600) * 1000 }
    return token.value
  }

  async function call<T>(method: string, path: string, params: Record<string, string> = {}, body?: unknown): Promise<T> {
    const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      const err = `Drive ${method} ${path}: ${res.status} ${text.slice(0, 300)}`
      throw res.status === 404 || res.status === 403 ? new PermanentError(err) : new Error(err)
    }
    return (await res.json()) as T
  }

  const quote = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")

  /** Busca (o crea) una subcarpeta por nombre. Idempotente. */
  async function folder(name: string, parent: string): Promise<string> {
    const key = `${parent}/${name}`
    const cached = folderCache.get(key)
    if (cached) return cached
    const q = `name = '${quote(name)}' and mimeType = '${FOLDER}' and '${parent}' in parents and trashed = false`
    const found = await call<{ files: { id: string }[] }>("GET", "files", { q, fields: "files(id)" })
    const id =
      found.files[0]?.id ??
      (await call<{ id: string }>("POST", "files", { fields: "id" }, { name, mimeType: FOLDER, parents: [parent] })).id
    folderCache.set(key, id)
    return id
  }

  async function path(parts: string[]): Promise<string> {
    let parent = cfg.rootId
    for (const p of parts) parent = await folder(p, parent)
    return parent
  }

  return {
    /** Archivo ya subido para este asset (lo marca appProperties): evita duplicar en un reintento. */
    async findByAsset(assetId: string): Promise<{ id: string; md5Checksum?: string } | null> {
      const q = `appProperties has { key='cos_asset_id' and value='${quote(assetId)}' } and trashed = false`
      const r = await call<{ files: { id: string; md5Checksum?: string }[] }>("GET", "files", {
        q,
        fields: "files(id,md5Checksum)",
      })
      return r.files[0] ?? null
    },

    /** Subida resumible (sirve para videos de cientos de MB). */
    async upload(opts: {
      folderPath: string[]
      name: string
      mime: string
      data: Buffer
      appProperties: Record<string, string>
    }): Promise<{ id: string; md5Checksum?: string }> {
      const parent = await path(opts.folderPath)
      const start = await fetch(`${UPLOAD}?uploadType=resumable&fields=id,md5Checksum`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": opts.mime,
          "X-Upload-Content-Length": String(opts.data.byteLength),
        },
        body: JSON.stringify({ name: opts.name, parents: [parent], appProperties: opts.appProperties }),
      })
      const session = start.headers.get("location")
      if (!start.ok || !session) throw new Error(`Drive: no pude iniciar la subida (${start.status} ${await start.text()})`)
      const put = await fetch(session, {
        method: "PUT",
        headers: { "Content-Type": opts.mime, "Content-Length": String(opts.data.byteLength) },
        body: new Uint8Array(opts.data),
      })
      if (!put.ok) throw new Error(`Drive: falló la subida (${put.status} ${(await put.text()).slice(0, 300)})`)
      return (await put.json()) as { id: string; md5Checksum?: string }
    },

    async download(fileId: string): Promise<Buffer> {
      const res = await fetch(`${API}/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${await accessToken()}` },
      })
      if (!res.ok) {
        const err = `Drive: no pude bajar ${fileId} (${res.status})`
        throw res.status === 404 ? new PermanentError(err) : new Error(err)
      }
      return Buffer.from(await res.arrayBuffer())
    },
  }
}

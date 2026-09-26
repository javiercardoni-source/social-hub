/**
 * Medios con ffprobe/ffmpeg (vienen en la imagen del worker). Todo en una carpeta
 * temporal que se borra al terminar: el worker no guarda nada en disco (PLAN §2).
 */
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { promisify } from "node:util"

const run = promisify(execFile)
const FF_TIMEOUT_MS = 120_000

export type Probe = {
  mediaType: "photo" | "video"
  width: number
  height: number
  durationMs: number | null
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

/** Corre fn con una carpeta temporal propia y la borra siempre. */
export async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "cos-"))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export async function probe(file: string, mime: string | null): Promise<Probe> {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file],
    { timeout: FF_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
  )
  const info = JSON.parse(stdout) as {
    streams?: { codec_type?: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[]
    format?: { duration?: string; format_name?: string }
  }
  const v = info.streams?.find((s) => s.codec_type === "video")
  if (!v?.width || !v.height) throw new Error("el archivo no tiene imagen legible")

  // Los celulares graban "acostado" y marcan la rotación: el ancho real es el alto.
  const rotation = Math.abs(Number(v.tags?.rotate ?? v.side_data_list?.find((d) => d.rotation != null)?.rotation ?? 0))
  const [width, height] = rotation === 90 || rotation === 270 ? [v.height, v.width] : [v.width, v.height]

  const imageFormats = /image2|png_pipe|jpeg_pipe|webp_pipe|heif|gif/
  const isPhoto = mime?.startsWith("image/") || imageFormats.test(info.format?.format_name ?? "")
  const duration = Number(info.format?.duration)
  return {
    mediaType: isPhoto ? "photo" : "video",
    width,
    height,
    durationMs: !isPhoto && Number.isFinite(duration) ? Math.round(duration * 1000) : null,
  }
}

/** Miniatura JPG de 480 px de ancho (del segundo 1 si es video). */
export async function thumbnail(file: string, probeInfo: Probe, dir: string): Promise<Buffer> {
  const out = join(dir, "thumb.jpg")
  const seek = probeInfo.mediaType === "video" && (probeInfo.durationMs ?? 0) > 1500 ? ["-ss", "1"] : []
  await run("ffmpeg", ["-y", ...seek, "-i", file, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", out], {
    timeout: FF_TIMEOUT_MS,
  })
  return readFile(out)
}

/**
 * Imágenes para la IA: la foto achicada a 1024 px, o 4 fotogramas del video
 * repartidos (10 %, 35 %, 60 %, 85 %). JPG, que es lo más barato de mandar.
 */
export async function framesForAi(file: string, probeInfo: Probe, dir: string): Promise<Buffer[]> {
  const shots =
    probeInfo.mediaType === "video" && probeInfo.durationMs
      ? [0.1, 0.35, 0.6, 0.85].map((f) => (probeInfo.durationMs! / 1000) * f)
      : [null]
  const frames: Buffer[] = []
  for (const [i, at] of shots.entries()) {
    const out = join(dir, `frame-${i}.jpg`)
    const seek = at == null ? [] : ["-ss", at.toFixed(2)]
    await run("ffmpeg", ["-y", ...seek, "-i", file, "-frames:v", "1", "-vf", "scale='min(1024,iw)':-2", "-q:v", "3", out], {
      timeout: FF_TIMEOUT_MS,
    })
    frames.push(await readFile(out))
  }
  return frames
}

export async function writeTmp(dir: string, name: string, data: Buffer): Promise<string> {
  const p = join(dir, name)
  await writeFile(p, data)
  return p
}

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
  // Foto: 1568 px (el máximo que aprovecha la IA; a 1024 confundía ingredientes). Video: 4 cuadros a 1024.
  const lado = probeInfo.mediaType === "video" ? 1024 : 1568
  for (const [i, at] of shots.entries()) {
    const out = join(dir, `frame-${i}.jpg`)
    const seek = at == null ? [] : ["-ss", at.toFixed(2)]
    await run("ffmpeg", ["-y", ...seek, "-i", file, "-frames:v", "1", "-vf", `scale='min(${lado},iw)':-2`, "-q:v", "3", out], {
      timeout: FF_TIMEOUT_MS,
    })
    frames.push(await readFile(out))
  }
  return frames
}

/** Instagram solo acepta JPEG: convierte PNG/HEIC/WebP (máximo 1440 px, calidad alta). */
export async function toJpeg(file: string, dir: string): Promise<Buffer> {
  const out = join(dir, "publish.jpg")
  await run("ffmpeg", ["-y", "-i", file, "-frames:v", "1", "-vf", "scale='min(1440,iw)':-2", "-q:v", "2", out], {
    timeout: FF_TIMEOUT_MS,
  })
  return readFile(out)
}

/**
 * Encaja una foto en un rango de proporciones sin recortar nada: si se pasa, se completa
 * hasta el formato con la misma foto desenfocada de fondo. Siempre devuelve JPEG.
 */
async function fitPhoto(file: string, dir: string, min: number, max: number, tall: [number, number], wide: [number, number]) {
  const info = await probe(file, "image/jpeg")
  const ratio = info.width / info.height
  if (ratio >= min && ratio <= max) return toJpeg(file, dir)
  const [w, h] = ratio < min ? tall : wide
  const out = join(dir, "fit.jpg")
  const filter =
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=30:3[bg];` +
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`
  await run("ffmpeg", ["-y", "-i", file, "-filter_complex", filter, "-frames:v", "1", "-q:v", "2", out], {
    timeout: FF_TIMEOUT_MS,
  })
  return readFile(out)
}

/** Feed de Instagram: entre 4:5 y 1,91:1 (si no, Meta la rechaza). */
export const fitForInstagramFeed = (file: string, dir: string) => fitPhoto(file, dir, 0.8, 1.91, [1080, 1350], [1440, 754])

/** Historia: 9:16 (se tolera un poco de margen). */
export const fitForStory = (file: string, dir: string) => fitPhoto(file, dir, 0.55, 0.58, [1080, 1920], [1080, 1920])

/** Pega una capa PNG (del mismo tamaño) sobre una foto. Devuelve JPEG. */
export async function compositePhoto(base: Buffer, layer: Buffer, dir: string): Promise<Buffer> {
  const b = await writeTmp(dir, "base.jpg", base)
  const l = await writeTmp(dir, "layer.png", layer)
  const out = join(dir, "final.jpg")
  await run("ffmpeg", ["-y", "-i", b, "-i", l, "-filter_complex", "[0:v][1:v]overlay=0:0", "-frames:v", "1", "-q:v", "2", out], {
    timeout: FF_TIMEOUT_MS,
  })
  return readFile(out)
}

/** Pega la capa sobre todo el video (se re-codifica: H.264, audio intacto). */
export async function compositeVideo(base: Buffer, layer: Buffer, dir: string): Promise<Buffer> {
  const b = await writeTmp(dir, "base.mp4", base)
  const l = await writeTmp(dir, "layer.png", layer)
  const out = join(dir, "final.mp4")
  await run(
    "ffmpeg",
    ["-y", "-i", b, "-i", l, "-filter_complex", "[0:v][1:v]overlay=0:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
     "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out],
    { timeout: 10 * 60_000 },
  )
  return readFile(out)
}

export async function audioSeconds(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { timeout: FF_TIMEOUT_MS })
  return Number(stdout.trim()) || 0
}

export async function hasAudio(file: string): Promise<boolean> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], {
    timeout: FF_TIMEOUT_MS,
  })
  return stdout.trim().length > 0
}

const MUSIC_FADE = (seconds: number) => `afade=t=in:d=0.6,afade=t=out:st=${Math.max(seconds - 1.2, 0)}:d=1.2,loudnorm=I=-14:TP=-1.5`

/**
 * Foto → reel: 1080×1920, zoom lento, la capa de la plantilla quieta encima y un tema de la
 * biblioteca de la marca (con fundido y volumen normalizado al nivel de Instagram).
 */
export async function photoToReel(opts: { photo9x16: Buffer; layer: Buffer | null; music: Buffer | null; seconds: number; dir: string }): Promise<Buffer> {
  const { dir, seconds } = opts
  const img = await writeTmp(dir, "reel-base.jpg", opts.photo9x16)
  const frames = Math.round(seconds * 30)
  const args = ["-y", "-loop", "1", "-i", img]
  if (opts.layer) args.push("-i", await writeTmp(dir, "reel-layer.png", opts.layer))
  // Sin tema elegido: pista muda (Instagram necesita una pista de audio igual).
  // Con tema: se arranca a un cuarto del tema, salteando la intro (suele ser la parte floja).
  if (opts.music) {
    const m = await writeTmp(dir, "music.audio", opts.music)
    const total = await audioSeconds(m)
    const start = total > seconds * 3 ? Math.floor(total * 0.25) : 0
    args.push("-ss", String(start), "-i", m)
  } else args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo")
  const audioIn = opts.layer ? 2 : 1
  const zoom = `[0:v]scale=2160:3840,zoompan=z='min(zoom+0.0005,1.1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,setsar=1[bg]`
  const video = opts.layer ? `${zoom};[bg][1:v]overlay=0:0,format=yuv420p[v]` : `${zoom};[bg]format=yuv420p[v]`
  const out = join(dir, "reel.mp4")
  args.push(
    "-filter_complex", `${video};[${audioIn}:a]atrim=0:${seconds},${MUSIC_FADE(seconds)}[a]`,
    "-map", "[v]", "-map", "[a]", "-t", String(seconds),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
  )
  await run("ffmpeg", args, { timeout: 10 * 60_000 })
  return readFile(out)
}

/** Video con la capa de la plantilla (opcional) y música de fondo (opcional, bajo el sonido original). */
export async function finishVideo(opts: { video: Buffer; layer: Buffer | null; music: Buffer | null; dir: string }): Promise<Buffer> {
  const { dir } = opts
  const v = await writeTmp(dir, "base.mp4", opts.video)
  const info = await probe(v, "video/mp4")
  const seconds = (info.durationMs ?? 15_000) / 1000
  const args = ["-y", "-i", v]
  let idx = 1
  const filters: string[] = []
  let vOut = "0:v"
  if (opts.layer) {
    args.push("-i", await writeTmp(dir, "layer.png", opts.layer))
    filters.push(`[0:v][${idx}:v]overlay=0:0,format=yuv420p[v]`)
    vOut = "[v]"
    idx++
  }
  let aMap: string[] = ["-map", "0:a?"]
  if (opts.music) {
    args.push("-stream_loop", "-1", "-i", await writeTmp(dir, "music.audio", opts.music))
    const m = `[${idx}:a]atrim=0:${seconds},${MUSIC_FADE(seconds)}`
    if (await hasAudio(v)) filters.push(`${m},volume=0.35[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]`)
    else filters.push(`${m}[a]`)
    aMap = ["-map", "[a]"]
  }
  const out = join(dir, "final.mp4")
  if (filters.length) args.push("-filter_complex", filters.join(";"))
  args.push("-map", vOut, ...aMap, "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out)
  await run("ffmpeg", args, { timeout: 10 * 60_000 })
  return readFile(out)
}

export async function writeTmp(dir: string, name: string, data: Buffer): Promise<string> {
  const p = join(dir, name)
  await writeFile(p, data)
  return p
}

/** Tope de subida del proyecto Supabase (el bucket admite más, pero el proyecto corta en 50 MB). */
export const UPLOAD_MAX_BYTES = 48 * 1024 * 1024

/**
 * Achica un video para que entre en el almacenamiento: lado largo hasta 1920 px, H.264 + AAC.
 * Instagram igual lo recomprime a 1080p, así que no se pierde calidad visible. Prueba dos
 * niveles; devuelve null si ni así entra.
 */
export async function compactVideo(video: Buffer, dir: string): Promise<Buffer | null> {
  const input = await writeTmp(dir, "grande.mp4", video)
  const { readFile } = await import("node:fs/promises")
  for (const crf of [23, 28]) {
    const out = `${dir}/compacto-${crf}.mp4`
    await run(
      "ffmpeg",
      [
        "-y", "-i", input,
        "-vf", "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
        out,
      ],
      { timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024 },
    )
    const data = await readFile(out)
    if (data.byteLength <= UPLOAD_MAX_BYTES) return data
  }
  return null
}

/**
 * Momentos de corte de un video (segundos), medidos con la detección de escenas de ffmpeg.
 * Es el dato duro del "ritmo de edición" de una referencia.
 */
export async function sceneCuts(file: string, threshold = 0.3): Promise<number[]> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", file, "-vf", `select='gt(scene,${threshold})',showinfo`, "-an", "-f", "null", "-"], {
    timeout: 5 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t > 0.05)
}

/** Cuadros en momentos dados (segundos), a 768 px: para que la IA "vea" el video en orden. */
export async function framesAt(file: string, times: number[], dir: string): Promise<Buffer[]> {
  const out: Buffer[] = []
  for (const [i, t] of times.entries()) {
    const f = join(dir, `ref-${i}.jpg`)
    await run("ffmpeg", ["-y", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale='min(768,iw)':-2", "-q:v", "4", f], { timeout: FF_TIMEOUT_MS })
    out.push(await readFile(f))
  }
  return out
}

/** Placa de fondo 9:16 del color de la marca (con viñeta suave): para historias sin foto. */
export async function placaFondo(hex: string, dir: string): Promise<Buffer> {
  const out = join(dir, "placa.jpg")
  await run(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", `color=c=0x${hex.replace("#", "")}:s=1080x1920`, "-vf", "vignette=PI/5", "-frames:v", "1", "-q:v", "2", out],
    { timeout: FF_TIMEOUT_MS },
  )
  return readFile(out)
}

/**
 * Imagen de la grilla del perfil (3 columnas, miniaturas 3:4) para que la IA la mire entera.
 * Cada casilla sin imagen va en gris. Máximo 18 casillas (6 filas).
 */
export async function grillaImagen(imgs: (Buffer | null)[], dir: string): Promise<Buffer> {
  const n = Math.min(18, imgs.length)
  const filas = Math.max(1, Math.ceil(n / 3))
  for (let i = 0; i < filas * 3; i++) {
    const out = join(dir, `g${String(i).padStart(2, "0")}.jpg`)
    const img = imgs[i]
    if (img && i < n) {
      const src = await writeTmp(dir, `src${i}`, img)
      await run("ffmpeg", ["-y", "-i", src, "-vf", "scale=300:400:force_original_aspect_ratio=increase,crop=300:400", "-frames:v", "1", "-q:v", "4", out], { timeout: FF_TIMEOUT_MS })
    } else {
      await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0xDDDDDD:s=300x400", "-frames:v", "1", out], { timeout: FF_TIMEOUT_MS })
    }
  }
  const out = join(dir, "grilla.jpg")
  await run("ffmpeg", ["-y", "-framerate", "1", "-i", join(dir, "g%02d.jpg"), "-vf", `tile=3x${filas}:padding=6:color=white`, "-frames:v", "1", "-q:v", "3", out], { timeout: FF_TIMEOUT_MS })
  return readFile(out)
}

/**
 * Audio mono en float a `sr` Hz (hasta `maxSeconds`), para el análisis de la ficha de un tema
 * (BPM y energía: shared/cos/gustos.ts analizarAudio). 2 min a 11 kHz ≈ 5 MB.
 */
export async function decodeAudio(file: string, sr = 11025, maxSeconds = 120): Promise<Float32Array> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-t", String(maxSeconds), "-ac", "1", "-ar", String(sr), "-f", "f32le", "pipe:1"], {
    timeout: FF_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    encoding: "buffer",
  })
  const buf = stdout as Buffer
  // Copia alineada: el Buffer de Node puede no empezar en un múltiplo de 4.
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength - (buf.byteLength % 4)))
}

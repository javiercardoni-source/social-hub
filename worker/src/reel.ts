/**
 * F9 · Video primero — motor de reels (portado de docs/reels/referencia/reel-motor.ts, probado
 * con Javier el 30-09-2026: mismo resultado que Creatomate, en 1080×1920 y gratis).
 *
 *   fuentesParaGuion  lo que ve la IA: la foto chica, o un cuadro por toma medida de cada video
 *   planearReel       guion de la IA → normalizarGuion (si falla o no deja tomas: guion de respaldo)
 *   ensureReel        arma el video (si no existe ya) desde el guion guardado en cos_posts.montaje
 *
 * Todo con ffmpeg asíncrono: el worker tiene que poder renovar su lease mientras arma (1-2 min).
 */
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import satori from "satori"
import { Resvg } from "@resvg/resvg-js"
import type { SupabaseClient } from "@supabase/supabase-js"
import { PermanentError } from "./queue.ts"
import { storageFor, supabaseStorage } from "./storage.ts"
import { probe, sceneCuts, withTmp, writeTmp } from "./media.ts"
import { KITS, kitDeMarca, type KitMarca } from "./overlay.ts"
import { exists, loadKit } from "./render.ts"
import { planReel, type BloqueFuente } from "./ai.ts"
import { CIERRE, FUNDIDO, CORTE, firmaReel, guionPorDefecto, lineaDeTiempo, normalizarExcluidos, normalizarGuion, type Fuente, type GuionReel } from "../../shared/cos/reel.ts"
import { ajustarAlPulso } from "../../shared/cos/ritmo.ts"
import type { BrandContext } from "../../shared/cos/prompts.ts"

const run = promisify(execFile)
const FF_MS = 5 * 60_000
const ff = (args: string[]) => run("ffmpeg", ["-loglevel", "error", "-y", ...args], { timeout: FF_MS, maxBuffer: 64 * 1024 * 1024 })

/** Subir este número rearma todos los reels (si cambia el diseño del motor). */
export const REEL_VERSION = "2"
const W = 1080
const H = 1920

export type VersionReel = { id: string; storage_driver: string; storage_key: string | null; drive_file_id: string | null; mime: string | null }

async function bajar(db: SupabaseClient, v: VersionReel): Promise<Buffer> {
  const data =
    v.storage_driver === "supabase" && v.storage_key
      ? await supabaseStorage(db).download(v.storage_key)
      : await storageFor("drive", db).download(v.drive_file_id ?? v.storage_key ?? "")
  if (!data.byteLength) throw new PermanentError("un archivo del reel está vacío")
  return data
}

// ── Lo que ve la IA ────────────────────────────────────────────────────────

export type FuenteMedida = Fuente & { cortes: number[] }

/**
 * Por fuente: texto con su tipo y tomas medidas + cuadros (foto → la foto a 512 px; video → un
 * cuadro al medio de cada toma, máximo 6 por video).
 */
export async function fuentesParaGuion(db: SupabaseClient, versiones: VersionReel[]): Promise<{ fuentes: FuenteMedida[]; bloques: BloqueFuente[] }> {
  const fuentes: FuenteMedida[] = []
  const bloques: BloqueFuente[] = []
  // Partes de cada video que Javier marcó para no usar (Aprobaciones → Video original).
  const { data: marcas } = await db.from("cos_asset_versions").select("id, excluir").in("id", versiones.map((v) => v.id))
  const excluidasDe = new Map((marcas ?? []).map((m) => [m.id as string, m.excluir as unknown]))
  for (const [i, v] of versiones.entries()) {
    const data = await bajar(db, v)
    await withTmp(async (dir) => {
      const f = await writeTmp(dir, `f${i}`, data)
      const info = await probe(f, v.mime)
      if (info.mediaType === "photo") {
        fuentes.push({ tipo: "foto", duracion: null, cortes: [] })
        const out = join(dir, "p.jpg")
        await ff(["-i", f, "-frames:v", "1", "-update", "1", "-vf", "scale='min(512,iw)':-2", "-q:v", "4", out])
        bloques.push({ tipo: "texto", texto: `Fuente ${i} · foto` }, { tipo: "imagen", jpg: await readFile(out) })
        return
      }
      const dur = (info.durationMs ?? 0) / 1000
      const cortes = (await sceneCuts(f).catch(() => [] as number[])).filter((c) => c > 0.2 && c < dur - 0.2)
      const excluir = normalizarExcluidos(excluidasDe.get(v.id), dur)
      fuentes.push({ tipo: "video", duracion: dur, cortes, ...(excluir.length ? { excluir } : {}) })
      const bordes = [0, ...cortes, dur]
      // Las tomas que caen enteras en una parte excluida ni se le muestran a la IA.
      const dentro = (ini: number, fin: number) => excluir.some(([a, b]) => ini >= a - 0.05 && fin <= b + 0.05)
      const tomas = bordes
        .slice(0, -1)
        .map((ini, k) => ({ ini, fin: bordes[k + 1] }))
        .filter((t) => !dentro(t.ini, t.fin))
      bloques.push({
        tipo: "texto",
        texto:
          `Fuente ${i} · video de ${dur.toFixed(1)} s · tomas medidas: ${tomas.map((t) => `${t.ini.toFixed(1)}–${t.fin.toFixed(1)}`).join(", ")}` +
          (excluir.length ? ` · NO USAR (lo marcó el dueño): ${excluir.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)} s`).join(", ")}` : ""),
      })
      // Máximo 6 cuadros: se reparten entre las tomas (las más largas primero si sobran).
      const elegidas = tomas.length <= 6 ? tomas : [...tomas].sort((a, b) => b.fin - b.ini - (a.fin - a.ini)).slice(0, 6).sort((a, b) => a.ini - b.ini)
      for (const [k, t] of elegidas.entries()) {
        const seg = (t.ini + t.fin) / 2
        const out = join(dir, `v${k}.jpg`)
        await ff(["-ss", seg.toFixed(2), "-i", f, "-frames:v", "1", "-update", "1", "-vf", "scale='min(512,iw)':-2", "-q:v", "4", out])
        bloques.push({ tipo: "texto", texto: `Fuente ${i}, segundo ${seg.toFixed(1)}:` }, { tipo: "imagen", jpg: await readFile(out) })
      }
    })
  }
  return { fuentes, bloques }
}

/**
 * Guion del reel. Si la IA falla o no deja ninguna toma usable, un guion de respaldo (sin IA):
 * nunca queda un borrador sin reel. `temas` = nombres de archivo de la biblioteca de la marca.
 */
export async function planearReel(opts: {
  db: SupabaseClient
  model: string
  brand: BrandContext
  versiones: VersionReel[]
  temas: string[]
  combos: string[]
  prohibidas: string[]
  pedido?: string
  anterior?: { gancho: string; idea: string }
  assetId?: string
  postId?: string
  log: (msg: string, extra?: Record<string, unknown>) => void
}): Promise<{ guion: GuionReel; fuentes: FuenteMedida[]; respaldo: boolean }> {
  const { fuentes, bloques } = await fuentesParaGuion(opts.db, opts.versiones)
  try {
    const raw = await planReel({ db: opts.db, model: opts.model, brand: opts.brand, bloques, temas: opts.temas, combos: opts.combos, pedido: opts.pedido, anterior: opts.anterior, assetId: opts.assetId, postId: opts.postId })
    const ritmo = opts.brand.ritmoReel ?? "normal"
    const guion = normalizarGuion(raw, fuentes, opts.temas, { combos: opts.combos, prohibidas: opts.prohibidas, ritmo, karaoke: !!opts.brand.karaoke })
    // Con palabra por corte, la frase cumple el rol del gancho y del texto del medio.
    if (guion.palabras?.length) guion.medio = ""
    if (ritmo === "rafaga" && guion.musica) {
      // Cortes al pulso: cada toma dura un número entero de pulsos del tema elegido.
      const { data: tema } = await opts.db.from("cos_music_tracks").select("bpm, bpm_confidence").eq("storage_key", `music/${opts.brand.slug}/${guion.musica}`).maybeSingle()
      if (tema?.bpm && Number(tema.bpm_confidence ?? 0) >= 0.3) {
        guion.tomas = ajustarAlPulso(guion.tomas, Number(tema.bpm), "rafaga").map((t) => {
          // Si al alargar se pasa del final del video, se corre el inicio para que entre.
          const f = fuentes[t.fuente]
          if (f?.tipo !== "video" || f.duracion == null || t.trim_start + t.duracion <= f.duracion) return t
          return { ...t, trim_start: Math.max(0, Math.round((f.duracion - t.duracion) * 100) / 100), duracion: Math.min(t.duracion, f.duracion) }
        })
      }
    }
    if (guion.tomas.length >= 2) return { guion, fuentes, respaldo: false }
    opts.log("el guion de la IA no dejó tomas usables: va el de respaldo", { tomas: guion.tomas.length })
  } catch (e) {
    // Sin API key o IA caída de forma permanente: el respaldo igual arma el reel.
    opts.log("la IA no armó el guion: va el de respaldo", { error: String(e).slice(0, 300) })
  }
  return { guion: guionPorDefecto(fuentes, opts.temas), fuentes, respaldo: true }
}

// ── Armado ─────────────────────────────────────────────────────────────────

type Nodo = { type: string; props: Record<string, unknown> }
const el = (style: Record<string, unknown>, children?: unknown, type = "div"): Nodo => ({ type, props: { style: { display: "flex", ...style }, children } })

async function png(node: Nodo, file: string, kit: KitMarca) {
  const fonts = [
    { name: kit.titulo.name, data: kit.titulo.data, weight: kit.titulo.weight as 400, style: "normal" as const },
    { name: kit.texto.name, data: kit.texto.data, weight: kit.texto.weight as 400, style: "normal" as const },
  ]
  await writeFile(file, new Resvg(await satori(node as never, { width: W, height: H, fonts })).render().asPng())
}

/** Texto grande a la altura del 24 % (fuera de lo que tapa Instagram arriba). */
const textoArriba = (t: string, kit: KitMarca) =>
  el({ width: W, height: H, justifyContent: "center", paddingTop: H * 0.24 - 60 }, [
    el({ fontFamily: kit.titulo.name, fontSize: 118, color: "#fff", textShadow: "0 0 3px rgba(0,0,0,0.9), 0 2px 8px rgba(0,0,0,0.85), 0 6px 28px rgba(0,0,0,0.6)", textAlign: "center", maxWidth: W - 120 }, t),
  ])

/** Palabra por corte: grande, al centro (un poco arriba), con contorno para leerse sobre cualquier toma. */
const palabraCentro = (t: string, kit: KitMarca) =>
  el({ width: W, height: H, justifyContent: "center", alignItems: "center", paddingBottom: H * 0.08 }, [
    el({ fontFamily: kit.titulo.name, fontSize: t.length > 9 ? 150 : 190, color: "#fff", textShadow: "0 0 4px rgba(0,0,0,0.95), 0 3px 10px rgba(0,0,0,0.85), 0 8px 34px rgba(0,0,0,0.6)", textAlign: "center", maxWidth: W - 100, lineHeight: 1 }, t),
  ])

/** Placa final: título, precio (solo si hay), recuadro, pie (solo si hay) y logo si la marca lleva. */
const placaCierre = (g: GuionReel, kit: KitMarca) => {
  const precio = g.cierre?.precio ?? null
  const pie = g.cierre?.pie ?? null
  const logoAncho = kit.logo ? Math.min(420, Math.round(200 * kit.logo.aspect)) : 0
  return el({ width: W, height: H, backgroundColor: "#000", flexDirection: "column", alignItems: "center", paddingTop: H * 0.28 }, [
    el({ fontFamily: kit.titulo.name, fontSize: 162, color: "#fff", lineHeight: 1.05, textAlign: "center", maxWidth: W - 100 }, g.titulo_cierre || " "),
    ...(precio ? [el({ fontFamily: kit.titulo.name, fontSize: 140, color: "#fff", lineHeight: 1.1 }, precio)] : []),
    ...(g.recuadro
      ? [el({ marginTop: 40, backgroundColor: kit.etiqueta.bg, padding: "22px 44px" }, [el({ fontFamily: kit.titulo.name, fontSize: 64, color: kit.etiqueta.text, letterSpacing: "0.22em" }, g.recuadro)])]
      : []),
    el({ flexGrow: 1 }),
    ...(pie ? [el({ marginBottom: kit.logo ? 60 : 260, fontFamily: kit.texto.name, fontSize: 38, color: "#fff", letterSpacing: "0.48em", textAlign: "center", maxWidth: W - 120 }, pie)] : []),
    // Logo de la marca (FasutoFudo mascota, Bijutsukan logo blanco). Sensaciones va sin firma.
    ...(kit.logo
      ? [{ type: "img", props: { src: kit.logo.src, width: logoAncho, height: Math.round(logoAncho / kit.logo.aspect), style: { marginBottom: 220 } } } as Nodo]
      : []),
  ])
}

/** Arma el reel: tomas con movimiento, textos, cierre, unión con fundidos y música. */
export async function armarReel(opts: { guion: GuionReel; gancho: string; archivos: { tipo: "foto" | "video"; archivo: string }[]; kit: KitMarca; musica: string | null; dir: string }): Promise<{ archivo: string; total: number }> {
  const { guion: g, kit, dir, archivos } = opts
  if (!g.tomas.length) throw new PermanentError("el guion no tiene tomas")
  // 1) Cada toma a un clip 1080×1920 de 30 fps con movimiento.
  for (const [i, t] of g.tomas.entries()) {
    const f = archivos[t.fuente]
    if (!f) throw new PermanentError(`el guion usa la fuente ${t.fuente}, que no está en el post`)
    const d = t.duracion
    const k = `(t/${d})`
    const out = join(dir, `n${i}.mp4`)
    if (f.tipo === "video") {
      // Video: recorte vertical + acercamiento/alejamiento suave (18 %).
      const z = t.movimiento === "alejar" ? `(1.18-0.18*${k})` : `(1+0.18*${k})`
      await ff(["-ss", String(t.trim_start), "-t", String(d), "-i", f.archivo, "-an", "-vf",
        `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},scale=w='${W}*${z}':h='${H}*${z}':eval=frame,crop=${W}:${H}:x='(iw-${W})*${t.foco_x}':y='(ih-${H})*${t.foco_y}',fps=30,format=yuv420p,setsar=1`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-threads", "2", out])
    } else {
      // Foto: Ken Burns. Con eval=frame hay que dar w Y h (h=-2 rompe el crop al arrancar).
      const z = t.movimiento === "acercar" ? `(1+0.22*${k})` : t.movimiento === "alejar" ? `(1.22-0.22*${k})` : "1.12"
      const px = t.movimiento === "paneo_derecha" ? k : t.movimiento === "paneo_izquierda" ? `(1-${k})` : String(t.foco_x)
      await ff(["-loop", "1", "-t", String(d), "-i", f.archivo, "-vf",
        `scale=1350:2400:force_original_aspect_ratio=increase,fps=30,scale=w='iw*${z}':h='ih*${z}':eval=frame,crop=${W}:${H}:x='(iw-${W})*${px}':y='(ih-${H})*${t.foco_y}',format=yuv420p,setsar=1`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-threads", "2", out])
    }
  }
  // 1b) Palabra por corte (karaoke) y marcos inclinados: cada clip se compone sobre el color de la
  //     marca, achicado e inclinado ±3° (alternando), con su palabra grande al centro.
  if (g.inclinado || g.palabras?.length) {
    const fondo = kit.fondo
    for (const [i, t] of g.tomas.entries()) {
      const src = join(dir, `n${i}.mp4`)
      const out = join(dir, `k${i}.mp4`)
      const palabra = g.palabras?.[i]?.trim() ?? ""
      const ang = g.inclinado ? (i % 2 ? -1 : 1) * 0.052 : 0
      const marco = g.inclinado ? `scale=948:1686,rotate=${ang}:ow=${W}:oh=${H}:c=${fondo}` : "null"
      if (palabra) {
        await png(palabraCentro(palabra, kit), join(dir, `w${i}.png`), kit)
        await ff(["-i", src, "-loop", "1", "-t", String(t.duracion), "-i", join(dir, `w${i}.png`), "-filter_complex", `[0:v]${marco}[b];[b][1:v]overlay=0:0:shortest=1,format=yuv420p,setsar=1[v]`, "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-threads", "2", out])
      } else {
        await ff(["-i", src, "-vf", `${marco},format=yuv420p,setsar=1`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-threads", "2", out])
      }
      await rename(out, src)
    }
  }

  // 2) Textos y cierre. Con palabra por corte, la frase reemplaza al gancho y al texto del medio.
  const conPalabras = !!g.palabras?.some((p) => p.trim())
  if (opts.gancho && !conPalabras) await png(textoArriba(opts.gancho, kit), join(dir, "t-gancho.png"), kit)
  if (g.medio) await png(textoArriba(g.medio, kit), join(dir, "t-medio.png"), kit)
  await png(placaCierre(g, kit), join(dir, "cierre.png"), kit)
  await ff(["-loop", "1", "-t", String(CIERRE), "-i", join(dir, "cierre.png"), "-vf",
    `fps=30,scale=w='${W}*(1+0.04*t/${CIERRE})':h='${H}*(1+0.04*t/${CIERRE})':eval=frame,crop=${W}:${H},format=yuv420p,setsar=1`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", join(dir, "ncierre.mp4")])

  // 3) Unión con xfade (un corte es un fundido de un cuadro) + textos con fundido + música.
  //    Ráfaga (10 a 24 tomas): los clips se pegan uno detrás del otro con el demuxer concat (cortes
  //    secos, poca memoria: el worker no aguanta 24 entradas 1080×1920 abiertas a la vez) y después
  //    se hace un solo fundido hacia la placa final.
  const rafaga = g.ritmo === "rafaga"
  const lt = lineaDeTiempo(g.tomas, g.ritmo)
  let partes: { f: string; tr: "corte" | "fundido" | null }[]
  let inicios: number[]
  if (rafaga) {
    await writeFile(join(dir, "lista.txt"), g.tomas.map((_, i) => `file '${join(dir, `n${i}.mp4`)}'`).join("\n"))
    await ff(["-f", "concat", "-safe", "0", "-i", join(dir, "lista.txt"), "-c", "copy", join(dir, "base.mp4")])
    partes = [{ f: join(dir, "base.mp4"), tr: null }, { f: join(dir, "ncierre.mp4"), tr: "fundido" }]
    inicios = [0, lt.cierre]
  } else {
    partes = [...g.tomas.map((t, i) => ({ f: join(dir, `n${i}.mp4`), tr: i === 0 ? null : t.transicion })), { f: join(dir, "ncierre.mp4"), tr: "fundido" as const }]
    inicios = [...lt.inicios, lt.cierre]
  }
  let filtro = ""
  let prev = "[0:v]"
  for (let i = 1; i < partes.length; i++) {
    const dur = partes[i].tr === "fundido" ? FUNDIDO : CORTE
    filtro += `${prev}[${i}:v]xfade=transition=fade:duration=${dur}:offset=${inicios[i].toFixed(3)}[x${i}];`
    prev = `[x${i}]`
  }
  const n = partes.length
  const extra: string[] = []
  let idx = n
  const capas: string[] = []
  if (opts.gancho && !conPalabras) {
    extra.push("-loop", "1", "-t", "2", "-i", join(dir, "t-gancho.png"))
    filtro += `[${idx}:v]format=rgba,fade=in:st=0:d=0.45:alpha=1,fade=out:st=1.7:d=0.3:alpha=1,setpts=PTS+${(lt.inicios[0] + 0.3).toFixed(2)}/TB[g];`
    capas.push("[g]")
    idx++
  }
  if (g.medio && lt.inicios[2] != null) {
    extra.push("-loop", "1", "-t", "1.9", "-i", join(dir, "t-medio.png"))
    filtro += `[${idx}:v]format=rgba,fade=in:st=0:d=0.45:alpha=1,fade=out:st=1.6:d=0.3:alpha=1,setpts=PTS+${(lt.inicios[2] + 0.4).toFixed(2)}/TB[m];`
    capas.push("[m]")
    idx++
  }
  let base = prev
  capas.forEach((c, i) => {
    filtro += `${base}${c}overlay=eof_action=pass[o${i}];`
    base = `[o${i}]`
  })
  filtro += `${base}format=yuv420p[v]`
  if (opts.musica) {
    // En bucle: si el tema es más corto que el reel, no queda mudo el final.
    extra.push("-stream_loop", "-1", "-i", opts.musica)
    filtro += `;[${idx}:a]atrim=0:${lt.total.toFixed(2)},afade=t=out:st=${Math.max(0, lt.total - 1.5).toFixed(2)}:d=1.5,volume=0.85[a]`
  }
  const salida = join(dir, "reel.mp4")
  // Memoria acotada: el worker tiene 768 MB y 1 CPU. Con 8 entradas 1080×1920, decodificadores con
  // hilos por cuadro y x264 "medium" (lookahead de 40 cuadros) ffmpeg murió por memoria (30-09).
  // Un hilo por decodificador y por filtro, y lookahead corto.
  await ff([
    ...partes.flatMap((x) => ["-threads", "1", "-i", x.f]),
    ...extra,
    "-filter_threads", "1",
    "-filter_complex_threads", "1",
    "-filter_complex", filtro,
    "-map", "[v]",
    ...(opts.musica ? ["-map", "[a]", "-c:a", "aac", "-b:a", "160k"] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", "2", "-x264-params", "rc-lookahead=10", "-movflags", "+faststart",
    "-t", lt.total.toFixed(2),
    salida,
  ])
  return { archivo: salida, total: lt.total }
}

// ── La pieza de un post ────────────────────────────────────────────────────

export type ReelPost = {
  id: string
  brand_id: string
  brand_slug: string
  overlay_text: string
  music_key: string | null
  montaje: GuionReel
  versiones: VersionReel[]
}

/** Carga un post con guion y TODAS sus fuentes en orden. null = el post no es un reel con guion. */
export async function loadReelPost(
  db: SupabaseClient,
  postId: string,
): Promise<(ReelPost & { status: string; render_key: string | null; post_type: string; platform: string; diseno: unknown; tapa_key: string | null }) | null> {
  const { data, error } = await db
    .from("cos_posts")
    .select("id, status, brand_id, post_type, platform, overlay_text, music_key, montaje, render_key, diseno, tapa_key, cos_brands(slug), cos_post_media(position, cos_asset_versions(id, storage_driver, storage_key, drive_file_id, mime))")
    .eq("id", postId)
    .single()
  if (error || !data) throw new Error(`post ${postId}: ${error?.message ?? "no existe"}`)
  const row = data as unknown as {
    id: string
    status: string
    brand_id: string
    overlay_text: string
    music_key: string | null
    montaje: GuionReel | null
    render_key: string | null
    post_type: string
    platform: string
    diseno: unknown
    tapa_key: string | null
    cos_brands: { slug: string } | null
    cos_post_media: { position: number; cos_asset_versions: VersionReel | null }[]
  }
  if (!row.montaje) return null
  const versiones = [...row.cos_post_media].sort((a, b) => a.position - b.position).map((m) => m.cos_asset_versions).filter((v): v is VersionReel => !!v)
  if (!versiones.length) throw new PermanentError("el post no tiene archivos")
  return { ...row, montaje: row.montaje, brand_slug: row.cos_brands?.slug ?? "", versiones }
}

/**
 * Clave del video: sale de TODO lo que cambia el resultado (guion, gancho, música, fuentes, kit
 * de la marca, versión del motor). Es por contenido, no por post: el reel, la historia y el video
 * de Facebook de una misma subida comparten el archivo si son iguales.
 */
export function reelKey(p: ReelPost, kitVersion: string): string {
  const h = createHash("sha256")
    .update(firmaReel({ version: REEL_VERSION, guion: p.montaje, gancho: p.overlay_text, musicaKey: p.music_key, fuentes: p.versiones.map((v) => v.id), kitVersion, kitMarca: KITS[p.brand_slug] ?? null }))
    .digest("hex")
    .slice(0, 20)
  return `renders/reels/${p.brand_slug}/${h}.mp4`
}

/** Arma el reel si no existe y devuelve su clave. */
export async function ensureReel(db: SupabaseClient, p: ReelPost): Promise<string> {
  const custom = await loadKit(db, p.brand_id)
  const key = reelKey(p, custom?.version ?? "")
  if (await exists(db, key)) return key
  const kit = await kitDeMarca(p.brand_slug, custom)
  if (!kit) throw new PermanentError(`la marca ${p.brand_slug} no tiene kit de diseño`)
  const video = await withTmp(async (dir) => {
    const archivos: { tipo: "foto" | "video"; archivo: string }[] = []
    for (const [i, v] of p.versiones.entries()) {
      const f = await writeTmp(dir, `src${i}`, await bajar(db, v))
      archivos.push({ tipo: (await probe(f, v.mime)).mediaType === "video" ? "video" : "foto", archivo: f })
    }
    const musica = p.music_key ? await writeTmp(dir, "musica", await supabaseStorage(db).download(p.music_key)) : null
    const r = await armarReel({ guion: p.montaje, gancho: p.overlay_text, archivos, kit, musica, dir })
    return readFile(r.archivo)
  })
  await supabaseStorage(db).upload(key, video, "video/mp4")
  return key
}

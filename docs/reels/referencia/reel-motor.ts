/**
 * REFERENCIA (no es código de producción): el motor de reels que se probó el 30-09-2026 con
 * Javier y dio el mismo resultado que Creatomate, en 1080×1920 y gratis.
 *   - Reel desde un video (Sensa15.mp4, Social.mp4): tomas recortadas + acercamiento.
 *   - Reel desde 5 fotos: Ken Burns (acercar / alejar / paneo) por foto.
 * Todo con ffmpeg + satori. Llevar esto a worker/src/reel.ts (ver docs/reels/HANDOFF.md).
 */
import satori from "satori"
import { Resvg } from "@resvg/resvg-js"
import { writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { CIERRE, lineaDeTiempo, type GuionReel } from "../../../shared/cos/reel.ts"

const ff = (args: string[]) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 })
type Fuente = { tipo: "foto" | "video"; archivo: string }
type Kit = { titulo: { name: string; data: Buffer }; texto: { name: string; data: Buffer }; etiqueta: { bg: string; text: string } }

const el = (style: object, children?: unknown) => ({ type: "div", props: { style: { display: "flex", ...style }, children } })

/** PNG transparente 1080×1920 (textos) o con fondo (cierre), con las tipografías de la marca. */
async function png(node: object, file: string, kit: Kit) {
  const fonts = [
    { name: kit.titulo.name, data: kit.titulo.data, weight: 400 as const, style: "normal" as const },
    { name: kit.texto.name, data: kit.texto.data, weight: 400 as const, style: "normal" as const },
  ]
  writeFileSync(file, new Resvg(await satori(node as never, { width: 1080, height: 1920, fonts })).render().asPng())
}

/** Texto grande a la altura del 24 % (fuera de la zona que tapa Instagram arriba). */
const textoArriba = (t: string, kit: Kit) =>
  el({ width: 1080, height: 1920, justifyContent: "center", paddingTop: 1920 * 0.24 - 60 }, [
    el({ fontFamily: kit.titulo.name, fontSize: 118, color: "#fff", textShadow: "0 6px 24px rgba(0,0,0,0.6)" }, t),
  ])

/** Placa final: título, precio (solo si hay), recuadro, pie (solo si hay zonas). Fondo negro. */
const cierre = (g: GuionReel, kit: Kit, precio: string | null, pie: string | null) =>
  el({ width: 1080, height: 1920, backgroundColor: "#000", flexDirection: "column", alignItems: "center", paddingTop: 1920 * 0.28 }, [
    el({ fontFamily: kit.titulo.name, fontSize: 162, color: "#fff", lineHeight: 1.05 }, g.titulo_cierre),
    ...(precio ? [el({ fontFamily: kit.titulo.name, fontSize: 140, color: "#fff", lineHeight: 1.1 }, precio)] : []),
    ...(g.recuadro
      ? [el({ marginTop: 40, backgroundColor: kit.etiqueta.bg, padding: "22px 44px" }, [el({ fontFamily: kit.titulo.name, fontSize: 64, color: kit.etiqueta.text, letterSpacing: "0.22em" }, g.recuadro)])]
      : []),
    ...(pie ? [el({ marginTop: 300, fontFamily: kit.texto.name, fontSize: 38, color: "#fff", letterSpacing: "0.48em" }, pie)] : []),
  ])

export async function armarReel(opts: { guion: GuionReel; fuentes: Fuente[]; kit: Kit; precio: string | null; pie: string | null; musica: string | null; dir: string; salida: string }) {
  const { guion: g, fuentes, kit, dir } = opts
  // 1) Cada toma a un clip 1080×1920 de 30 fps con movimiento.
  g.tomas.forEach((t, i) => {
    const d = t.duracion
    const k = `(t/${d})`
    const out = `${dir}/n${i}.mp4`
    const f = fuentes[t.fuente]
    if (f.tipo === "video") {
      // Video: recorte vertical + acercamiento/alejamiento suave (18 %).
      const z = t.movimiento === "alejar" ? `(1.18-0.18*${k})` : `(1+0.18*${k})`
      ff(["-ss", String(t.trim_start), "-t", String(d), "-i", f.archivo, "-an", "-vf",
        `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,scale=w='1080*${z}':h='1920*${z}':eval=frame,crop=1080:1920,fps=30,format=yuv420p,setsar=1`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", out])
    } else {
      // Foto: Ken Burns. OJO: con eval=frame hay que dar w Y h (h=-2 rompe el crop al arrancar).
      const z = t.movimiento === "acercar" ? `(1+0.22*${k})` : t.movimiento === "alejar" ? `(1.22-0.22*${k})` : "1.12"
      const px = t.movimiento === "paneo_derecha" ? k : t.movimiento === "paneo_izquierda" ? `(1-${k})` : String(t.foco_x)
      ff(["-loop", "1", "-t", String(d), "-i", f.archivo, "-vf",
        `scale=1350:2400:force_original_aspect_ratio=increase,fps=30,scale=w='iw*${z}':h='ih*${z}':eval=frame,crop=1080:1920:x='(iw-1080)*${px}':y='(ih-1920)*${t.foco_y}',format=yuv420p,setsar=1`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", out])
    }
  })
  // 2) Textos y cierre.
  await png(textoArriba(g.gancho, opts.kit), `${dir}/t-gancho.png`, kit)
  if (g.medio) await png(textoArriba(g.medio, opts.kit), `${dir}/t-medio.png`, kit)
  await png(cierre(g, kit, opts.precio, opts.pie), `${dir}/cierre.png`, kit)
  ff(["-loop", "1", "-t", String(CIERRE), "-i", `${dir}/cierre.png`, "-vf",
    `fps=30,scale=w='1080*(1+0.04*t/${CIERRE})':h='1920*(1+0.04*t/${CIERRE})':eval=frame,crop=1080:1920,format=yuv420p,setsar=1`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", `${dir}/ncierre.mp4`])

  // 3) Unión con xfade (corte = fundido de 0,04 s) + textos con fundido + música con fade out.
  const partes = [...g.tomas.map((t, i) => ({ f: `${dir}/n${i}.mp4`, d: t.duracion, tr: i === 0 ? null : t.transicion })), { f: `${dir}/ncierre.mp4`, d: CIERRE, tr: "fundido" as const }]
  const lt = lineaDeTiempo(g.tomas)
  const inicios = [...lt.inicios, lt.cierre] // el cierre entra con fundido al final de la última toma
  const total = lt.total
  let filtro = ""
  let prev = "[0:v]"
  for (let i = 1; i < partes.length; i++) {
    const dur = partes[i].tr === "fundido" ? 0.45 : 0.04
    filtro += `${prev}[${i}:v]xfade=transition=fade:duration=${dur}:offset=${inicios[i].toFixed(3)}[x${i}];`
    prev = `[x${i}]`
  }
  const n = partes.length
  const extra: string[] = ["-loop", "1", "-t", "2", "-i", `${dir}/t-gancho.png`]
  filtro += `[${n}:v]format=rgba,fade=in:st=0:d=0.45:alpha=1,fade=out:st=1.7:d=0.3:alpha=1,setpts=PTS+${(inicios[0] + 0.3).toFixed(2)}/TB[g];`
  let capa = `${prev}[g]overlay=eof_action=pass`
  if (g.medio) {
    extra.push("-loop", "1", "-t", "1.9", "-i", `${dir}/t-medio.png`)
    filtro += `[${n + 1}:v]format=rgba,fade=in:st=0:d=0.45:alpha=1,fade=out:st=1.6:d=0.3:alpha=1,setpts=PTS+${(inicios[2] + 0.4).toFixed(2)}/TB[m];`
    capa += `[o1];[o1][m]overlay=eof_action=pass`
  }
  filtro += `${capa},format=yuv420p[v]`
  const audioIdx = n + (g.medio ? 2 : 1)
  if (opts.musica) {
    extra.push("-i", opts.musica)
    filtro += `;[${audioIdx}:a]atrim=0:${total.toFixed(2)},afade=t=out:st=${(total - 1.5).toFixed(2)}:d=1.5,volume=0.85[a]`
  }
  ff([...partes.flatMap((x) => ["-i", x.f]), ...extra, "-filter_complex", filtro, "-map", "[v]", ...(opts.musica ? ["-map", "[a]", "-c:a", "aac", "-b:a", "160k"] : []),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-movflags", "+faststart", "-shortest", opts.salida])
  return { total }
}

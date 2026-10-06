/**
 * Diseño gráfico para imprenta (06-10-2026). impresion:render arma una pieza de cos_print_pieces:
 * la dibuja a la medida de corte con la plantilla y la paleta de la marca, le agrega el sangrado
 * extendiendo los bordes en espejo y la entrega en JPG con la resolución marcada (la imprenta la
 * abre con la medida real).
 */
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import QRCode from "qrcode"
import type { Handler } from "./handlers.ts"
import { PermanentError } from "./queue.ts"
import { storageFor, supabaseStorage } from "./storage.ts"
import { probe, withTmp, writeTmp } from "./media.ts"
import { kitDiseno } from "./overlay.ts"
import { loadKit } from "./render.ts"
import { renderDiseno } from "./diseno.ts"
import { normalizarCampos, plantilla } from "../../shared/cos/plantillas.ts"
import { avisoFoto, conDpi, linkWhatsapp, medidas } from "../../shared/cos/impresion.ts"

const run = promisify(execFile)
const FF = { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 }

const renderImpresion: Handler = async (job, { db, log }) => {
  const id = typeof job.payload.pieza_id === "string" ? job.payload.pieza_id : ""
  if (!id) throw new PermanentError("payload sin pieza_id")
  const { data: pz } = await db
    .from("cos_print_pieces")
    .select("id, brand_id, plantilla, campos, version_id, cos_brands(slug, name), cos_print_formats(nombre, ancho_mm, alto_mm, sangrado_mm, dpi)")
    .eq("id", id)
    .single()
  if (!pz) throw new PermanentError("la pieza no existe")
  const marca = pz.cos_brands as unknown as { slug: string; name: string }
  const f = pz.cos_print_formats as unknown as { nombre: string; ancho_mm: number; alto_mm: number; sangrado_mm: number; dpi: number }
  const p = plantilla(pz.plantilla)
  try {
    if (!p) throw new PermanentError(`plantilla desconocida: ${pz.plantilla}`)
    const m = medidas({ ancho_mm: Number(f.ancho_mm), alto_mm: Number(f.alto_mm), sangrado_mm: Number(f.sangrado_mm), dpi: f.dpi })
    const custom = await loadKit(db, pz.brand_id)
    const kit = await kitDiseno(marca.slug, custom)
    if (!kit) throw new PermanentError(`la marca ${marca.slug} no tiene kit de diseño`)
    const campos = normalizarCampos(p, (pz.campos ?? {}) as Record<string, unknown>)
    const wa = campos.linea ? linkWhatsapp(campos.linea) : null
    const qr = p.id === "imp_pedido" && wa ? await QRCode.toDataURL(wa, { margin: 0, width: 600, errorCorrectionLevel: "M" }) : undefined

    let aviso: string | null = null
    const jpg = await withTmp(async (dir) => {
      // La foto, en alta: hasta 4000 px de lado (en impresión la foto rinde lo que trae).
      let fotoUri = ""
      if (pz.version_id) {
        const { data: v } = await db.from("cos_asset_versions").select("storage_driver, storage_key, drive_file_id, mime").eq("id", pz.version_id).single()
        if (v) {
          const b = v.storage_driver === "supabase" && v.storage_key ? await supabaseStorage(db).download(v.storage_key) : await storageFor("drive", db).download(v.drive_file_id ?? v.storage_key ?? "")
          const src = await writeTmp(dir, "foto", b)
          const info = await probe(src, v.mime)
          aviso = avisoFoto(info.width, info.height, m.ancho, m.alto)
          await run("ffmpeg", ["-y", "-i", src, "-frames:v", "1", "-vf", "scale='min(4000,iw)':-2", "-q:v", "2", join(dir, "foto.jpg")], FF)
          fotoUri = `data:image/jpeg;base64,${(await readFile(join(dir, "foto.jpg"))).toString("base64")}`
        }
      }
      if (!fotoUri && p.fotos) throw new PermanentError("la pieza necesita una foto")
      // 1) La pieza a la medida de corte.
      const png = await renderDiseno({ diseno: { plantilla: p.id, campos, numero: 1 }, marca: marca.slug, fotos: fotoUri ? [fotoUri] : [], kit, width: m.ancho, height: m.alto, qr, nombreMarca: marca.name })
      const corte = await writeTmp(dir, "corte.png", png)
      // 2) Sangrado: se agranda el lienzo y el borde se completa en espejo (sin filetes blancos al cortar).
      const s = m.sangrado
      const vf = s > 0 ? `pad=${m.totalAncho}:${m.totalAlto}:${s}:${s},fillborders=left=${s}:right=${s}:top=${s}:bottom=${s}:mode=mirror` : "null"
      await run("ffmpeg", ["-y", "-i", corte, "-vf", vf, "-q:v", "1", "-pix_fmt", "yuvj444p", join(dir, "final.jpg")], FF)
      return Buffer.from(conDpi(await readFile(join(dir, "final.jpg")), f.dpi))
    })
    const key = `prints/${marca.slug}/${pz.id}.jpg`
    await supabaseStorage(db).upload(key, jpg, "image/jpeg")
    await db.from("cos_print_pieces").update({ estado: "lista", archivo_key: key, aviso, error: null }).eq("id", pz.id)
    log("pieza de imprenta lista", { pieza: pz.id, formato: f.nombre, px: `${m.totalAncho}x${m.totalAlto}`, kb: Math.round(jpg.length / 1024) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Un error definitivo se muestra en la pantalla; uno pasajero se reintenta (la cola lo hace).
    if (e instanceof PermanentError || job.attempts >= (job.max_attempts ?? 5) - 1) await db.from("cos_print_pieces").update({ estado: "error", error: msg.slice(0, 300) }).eq("id", pz.id)
    throw e
  }
}

export const impresionHandlers: Record<string, Handler> = {
  "impresion:render": renderImpresion,
}

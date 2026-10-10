/**
 * Sets de anuncios a pedido (Anuncios → «Crear set», 10-10-2026). Javier escribe el texto que va
 * sobre la pieza y los detalles; el resultado es un set PARA DESCARGAR (no pasa por Meta).
 *
 *   ads:set          (set_id)      la IA elige el material REAL (Instagram, Archivo o lo elegido a
 *                                  mano), lo deja guardado en cos-media y escribe las versiones
 *   ads:set-version  (version_id)  arma una versión: video 9:16 + 4:5 (como el rearmado del motor)
 *                                  y/o imagen 9:16 + 4:5 (la foto con el texto de la marca encima)
 *
 * Producto real siempre: la IA descarta lo que parece hecho con IA, con precio o con sellos.
 */
import { readFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { join } from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Handler } from "./handlers.ts"
import { brandContext, settings } from "./handlers.ts"
import { PermanentError } from "./queue.ts"
import { storageFor, supabaseStorage } from "./storage.ts"
import { compositePhoto, probe, withTmp, writeTmp } from "./media.ts"
import { defaultTemplate, kitDeMarca, renderOverlay } from "./overlay.ts"
import { loadKit } from "./render.ts"
import { armarReel } from "./reel.ts"
import { bajarDeInstagram, CIERRE_CTA } from "./ads.ts"
import { elegirMaterial, versionesSet } from "./ads-ai.ts"
import { nombreDescarga, problemasTextoPieza, repartirMaterial, TOMAS_POR_VIDEO, type Elegido, type FormatoSet, type FuenteSet } from "../../shared/cos/ad-sets.ts"
import { guionRearmado } from "../../shared/cos/ads.ts"
import { cierreDesdeDatos } from "../../shared/cos/reel.ts"
import { normalizarDatos } from "../../shared/cos/datos-vigentes.ts"

const run = promisify(execFile)
const FF = { timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 }

/** Un archivo del set, ya guardado en cos-media. */
type Material = { origen: "instagram" | "archivo"; id: string; tipo: "foto" | "video"; key: string; thumb_key: string | null; duracion: number | null }
/** `texto`: lo que se sabe del archivo (descripción del empleado, resumen y productos de la IA, o el texto del post). */
type Candidata = { origen: "instagram" | "archivo"; id: string; thumb_key: string; texto: string }

/** Lo que dice un archivo del Archivo, en una línea para la IA. */
function textoArchivo(description: unknown, ai: unknown): string {
  const j = (ai ?? {}) as { summary?: string; products?: unknown[] }
  const productos = Array.isArray(j.products) ? j.products.map((p) => (typeof p === "string" ? p : (p as { name?: string })?.name)).filter(Boolean).join(", ") : ""
  return [description, j.summary, productos && `productos: ${productos}`].filter((x) => typeof x === "string" && x.trim()).join(" · ").slice(0, 400)
}
/** Lo que el Archivo ya marcó como generado con IA o de banco de imágenes: no es producto real. */
const esDeIA = (ai: unknown) => ((ai as { risk_flags?: unknown[] })?.risk_flags ?? []).some((f) => typeof f === "string" && /generad|banco|render/i.test(f))

/** Candidatas por fuente, las más prometedoras primero (la IA ve hasta 12 de cada una). */
async function candidatas(db: SupabaseClient, brandId: string, fuente: "instagram" | "archivo"): Promise<Candidata[]> {
  if (fuente === "instagram") {
    const { data } = await db
      .from("cos_media")
      .select("id, thumb_key, caption")
      .eq("brand_id", brandId)
      .eq("platform", "instagram")
      .in("format", ["feed", "reel", "carousel"])
      .not("thumb_key", "is", null)
      .gte("posted_at", new Date(Date.now() - 365 * 86_400_000).toISOString())
      .order("metrics->reach", { ascending: false, nullsFirst: false })
      .limit(12)
    return (data ?? []).map((m) => ({ origen: "instagram" as const, id: m.id as string, thumb_key: m.thumb_key as string, texto: ((m.caption as string | null) ?? "").slice(0, 400) }))
  }
  const { data } = await db
    .from("cos_assets")
    .select("id, thumb_key, description, ai_json")
    .eq("brand_id", brandId)
    .in("status", ["READY", "IN_USE"])
    .neq("consent", "blocked")
    .not("thumb_key", "is", null)
    .not("current_version_id", "is", null)
    .order("quality_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(30)
  return (data ?? [])
    .filter((a) => !esDeIA(a.ai_json))
    .slice(0, 12)
    .map((a) => ({ origen: "archivo" as const, id: a.id as string, thumb_key: a.thumb_key as string, texto: textoArchivo(a.description, a.ai_json) }))
}

/** Lo elegido a mano, solo si es de la marca (y del Archivo, sin consentimiento bloqueado). */
async function elegidosAMano(db: SupabaseClient, brandId: string, elegidos: Elegido[]): Promise<Candidata[]> {
  const ids = (o: Elegido["origen"]) => elegidos.filter((e) => e.origen === o).map((e) => e.id).concat("00000000-0000-0000-0000-000000000000")
  const [{ data: ig }, { data: ar }] = await Promise.all([
    db.from("cos_media").select("id, thumb_key").eq("brand_id", brandId).in("id", ids("instagram")),
    db.from("cos_assets").select("id, thumb_key").eq("brand_id", brandId).neq("consent", "blocked").not("current_version_id", "is", null).in("id", ids("archivo")),
  ])
  const ok = new Map<string, Candidata>([
    ...(ig ?? []).map((m) => [`instagram:${m.id}`, { origen: "instagram" as const, id: m.id as string, thumb_key: (m.thumb_key as string) ?? "", texto: "" }] as const),
    ...(ar ?? []).map((a) => [`archivo:${a.id}`, { origen: "archivo" as const, id: a.id as string, thumb_key: (a.thumb_key as string) ?? "", texto: "" }] as const),
  ])
  // En el orden en que los eligió Javier.
  return elegidos.map((e) => ok.get(`${e.origen}:${e.id}`)).filter((c): c is Candidata => !!c)
}

/** Baja el archivo original (Instagram o Archivo) y lo deja en cos-media para las versiones. */
async function guardarMaterial(db: SupabaseClient, c: Candidata, base: string, n: number): Promise<Material> {
  let buf: Buffer
  let esVideo: boolean
  if (c.origen === "instagram") ({ buf, esVideo } = await bajarDeInstagram(db, c.id))
  else {
    const { data: a } = await db.from("cos_assets").select("media_type, cos_asset_versions!cos_assets_current_version_fk(storage_driver, storage_key, drive_file_id, mime)").eq("id", c.id).single()
    const v = a?.cos_asset_versions as unknown as { storage_driver: string; storage_key: string | null; drive_file_id: string | null; mime: string | null } | null
    if (!v) throw new PermanentError("un archivo elegido del Archivo no tiene versión")
    buf = v.storage_driver === "supabase" && v.storage_key ? await supabaseStorage(db).download(v.storage_key) : await storageFor("drive", db).download(v.drive_file_id ?? v.storage_key ?? "")
    esVideo = a?.media_type === "video"
  }
  if (!buf.byteLength) throw new PermanentError("un archivo del material está vacío")
  const key = `${base}/material/${n}.${esVideo ? "mp4" : "jpg"}`
  const duracion = esVideo
    ? await withTmp(async (dir) => ((await probe(await writeTmp(dir, "m.mp4", buf), "video/mp4")).durationMs ?? 3000) / 1000)
    : null
  await supabaseStorage(db).upload(key, buf, esVideo ? "video/mp4" : "image/jpeg")
  return { origen: c.origen, id: c.id, tipo: esVideo ? "video" : "foto", key, thumb_key: c.thumb_key || null, duracion }
}

const prepararSet: Handler = async (job, { db, queue, log }) => {
  const id = typeof job.payload.set_id === "string" ? job.payload.set_id : ""
  if (!id) throw new PermanentError("payload sin set_id")
  const { data: set } = await db.from("cos_ad_sets").select("*").eq("id", id).single()
  if (!set || set.estado !== "preparando") return
  // Cada armado en su carpeta (el job): la subida no pisa archivos, y al rehacer no puede quedar el viejo.
  const base = `ads/sets/${id}/${job.id}`
  try {
    const s = await settings(db)
    const fuentes = set.fuentes as FuenteSet[]
    const pedido = [`Texto: ${set.textos}`, set.detalles ? `Detalles: ${set.detalles}` : ""].filter(Boolean).join("\n")

    // 1) El material: lo elegido a mano va primero y tal cual; lo de Instagram y el Archivo lo filtra la IA.
    const manual = fuentes.includes("manual") ? await elegidosAMano(db, set.brand_id, set.elegidos as Elegido[]) : []
    const auto = (await Promise.all((["instagram", "archivo"] as const).filter((f) => fuentes.includes(f)).map((f) => candidatas(db, set.brand_id, f)))).flat()
    const enManual = new Set(manual.map((c) => `${c.origen}:${c.id}`))
    const libres = auto.filter((c) => !enManual.has(`${c.origen}:${c.id}`))
    let elegidas: Candidata[] = []
    let motivo = manual.length ? `${manual.length} elegido${manual.length > 1 ? "s" : ""} a mano` : ""
    if (libres.length) {
      const thumbs = await Promise.all(libres.map((c) => supabaseStorage(db).download(c.thumb_key)))
      const v = await elegirMaterial({ db, model: s.ai_model, pedido, candidatas: thumbs.map((img, i) => ({ img, texto: libres[i].texto })) })
      elegidas = v.elegidas.map((i) => libres[i])
      motivo = [motivo, v.motivo].filter(Boolean).join(" · ")
    }
    const todas = [...manual, ...elegidas].slice(0, 8)
    if (!todas.length) {
      throw new PermanentError(
        auto.length
          ? `la IA no encontró fotos ni videos reales de lo que pedís (${motivo || "ninguno sirve"}). Probá con «Lo elijo yo»`
          : "no hay fotos ni videos en las fuentes elegidas",
      )
    }
    const material: Material[] = []
    for (const c of todas) {
      try {
        material.push(await guardarMaterial(db, c, base, material.length))
      } catch (e) {
        // Un archivo que no baja (link de Instagram vencido, Drive caído) no frena el set.
        log("ads:set: no se pudo bajar un archivo del material", { set: id, origen: c.origen, archivo: c.id, error: String(e) })
      }
    }
    if (!material.length) throw new PermanentError("no se pudo bajar ningún archivo del material")

    // 2) Las versiones del texto. La 1 es el texto de Javier; las de la IA tienen que pasar las reglas.
    const brand = await brandContext(db, set.brand_id)
    const pedirTextos = (extra?: string) => versionesSet({ db, model: s.ai_model, brand, textos: set.textos, detalles: set.detalles, cantidad: set.versiones, pedido: extra })
    let vs = await pedirTextos()
    const malas = (xs: typeof vs) => xs.slice(1).map((v, i) => ({ i: i + 2, p: problemasTextoPieza(v.texto) })).filter((x) => x.p.length)
    if (malas(vs).length) {
      const m = malas(vs).map((x) => `versión ${x.i}: ${x.p.join(", ")}`).join("; ")
      vs = await pedirTextos(`OJO, la vez anterior: ${m}. Corregilas.`)
    }
    const versiones = [
      { texto: set.textos.trim(), copy: vs[0]?.copy ?? "" },
      ...vs.slice(1).filter((v) => !problemasTextoPieza(v.texto).length),
    ].slice(0, set.versiones)

    // 3) Una fila por versión, cada una arrancando en otro archivo del material.
    const reparto = repartirMaterial(material.length, versiones.length, set.formato === "imagen" ? 1 : TOMAS_POR_VIDEO)
    const { data: filas, error } = await db
      .from("cos_ad_set_versiones")
      .upsert(versiones.map((v, i) => ({ set_id: id, numero: i + 1, texto: v.texto, copy: v.copy || null, material: reparto[i], estado: "armando", piezas: [], error: null })), { onConflict: "set_id,numero" })
      .select("id, numero")
    if (error) throw new Error(`cos_ad_set_versiones: ${error.message}`)
    await db.from("cos_ad_sets").update({ estado: "armando", material, motivo: motivo || null, error: null }).eq("id", id)
    for (const f of filas ?? []) await queue.enqueue("ads:set-version", { version_id: f.id }, { dedupeKey: `ads:set-version:${f.id}:${Date.now()}` })
    log("ads:set listo para armar", { set: id, material: material.length, versiones: versiones.length })
  } catch (e) {
    // En el último intento también se marca: que no quede «preparando» para siempre.
    if (e instanceof PermanentError || job.attempts >= (job.max_attempts ?? 5) - 1) {
      await db.from("cos_ad_sets").update({ estado: "error", error: String((e as Error).message).slice(0, 400) }).eq("id", id)
      if (e instanceof PermanentError) return
    }
    throw e
  }
}

/** Recorta (sin deformar) a ancho×alto exactos y devuelve el JPG. */
async function encuadrar(archivo: string, ancho: number, alto: number, esVideo: boolean, dir: string, nombre: string): Promise<Buffer> {
  const out = join(dir, nombre)
  await run("ffmpeg", ["-loglevel", "error", "-y", ...(esVideo ? ["-ss", "1"] : []), "-i", archivo, "-frames:v", "1", "-vf", `scale=${ancho}:${alto}:force_original_aspect_ratio=increase,crop=${ancho}:${alto}`, "-q:v", "2", out], FF)
  return readFile(out)
}

/** Cuando ya no queda ninguna versión armándose, el set queda listo. */
async function cerrarSiTermino(db: SupabaseClient, setId: string) {
  const { count } = await db.from("cos_ad_set_versiones").select("id", { count: "exact", head: true }).eq("set_id", setId).eq("estado", "armando")
  if (!count) await db.from("cos_ad_sets").update({ estado: "lista" }).eq("id", setId).eq("estado", "armando")
}

const armarVersion: Handler = async (job, { db, log }) => {
  const id = typeof job.payload.version_id === "string" ? job.payload.version_id : ""
  if (!id) throw new PermanentError("payload sin version_id")
  const { data: v } = await db.from("cos_ad_set_versiones").select("id, set_id, numero, texto, material, estado").eq("id", id).single()
  if (!v || v.estado !== "armando") return
  const { data: set } = await db.from("cos_ad_sets").select("id, brand_id, formato, material, cos_brands(slug, datos_vigentes)").eq("id", v.set_id).single()
  if (!set) return
  const marca = set.cos_brands as unknown as { slug: string; datos_vigentes: unknown }
  const formato = set.formato as FormatoSet
  const material = (set.material as Material[]) ?? []
  const usa = (v.material as number[]).map((i) => material[i]).filter(Boolean)
  // Renglón 1 = el título (apertura del video / título de la imagen); el resto = el segundo momento
  // (texto del medio del video / bajada de la imagen). «Puro salmón 40 piezas» → «Comé en casa».
  const [texto, ...resto] = (v.texto as string).split("\n").map((l) => l.trim()).filter(Boolean)
  const segundo = resto.join(" ")
  const st = supabaseStorage(db)
  // Con el nombre de descarga en la ruta: el link firmado baja «fasutofudo-v2-9x16.mp4».
  const base = `ads/sets/${set.id}`
  const ruta = (f: "9x16" | "4x5", tipo: "video" | "imagen") => `${base}/${job.id}/${nombreDescarga(marca.slug, v.numero, f, tipo)}`
  try {
    if (!texto) throw new PermanentError("la versión no tiene texto")
    if (!usa.length) throw new PermanentError("la versión no tiene material")
    const custom = await loadKit(db, set.brand_id)
    const piezas = await withTmp(async (dir) => {
      const out: { formato: "9x16" | "4x5"; tipo: "video" | "imagen"; key: string }[] = []
      const archivos = await Promise.all(usa.map(async (m, i) => ({ tipo: m.tipo, archivo: await writeTmp(dir, `m${i}.${m.tipo === "video" ? "mp4" : "jpg"}`, await st.download(m.key)) })))

      if (formato !== "imagen") {
        // Video: el mismo armado que el rearmado del motor (tomas reales + texto arriba + placa final).
        const kit = await kitDeMarca(marca.slug, custom)
        if (!kit) throw new PermanentError(`la marca ${marca.slug} no tiene kit de diseño`)
        const guion = guionRearmado(usa.map((m) => ({ tipo: m.tipo, duracion: m.duracion })), {
          gancho: texto,
          tituloCierre: CIERRE_CTA.WHATSAPP_MESSAGE,
          recuadro: "DELIVERY",
          pie: cierreDesdeDatos("", normalizarDatos(marca.datos_vigentes)).pie,
          idea: `set a pedido, versión ${v.numero}`,
          medio: segundo,
        })
        if (!guion) throw new PermanentError("no hay material para el video")
        const { data: temas } = await db.from("cos_music_tracks").select("storage_key").eq("brand_id", set.brand_id).order("energy", { ascending: false, nullsFirst: false }).limit(3)
        // Cada versión con otro tema (si la marca tiene varios).
        const tema = temas?.length ? temas[(v.numero - 1) % temas.length] : null
        const musica = tema ? await writeTmp(dir, "musica", await st.download(tema.storage_key as string)) : null
        const r = await armarReel({ guion, gancho: texto, archivos, kit, musica, dir })
        await st.upload(ruta("9x16", "video"), await readFile(r.archivo), "video/mp4")
        // 4:5 para el feed: recorte del 9:16 apenas corrido hacia abajo (el texto va al 24 % del alto).
        const f45 = join(dir, "4x5.mp4")
        await run("ffmpeg", ["-loglevel", "error", "-y", "-i", r.archivo, "-vf", "crop=1080:1350:0:330", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "copy", "-movflags", "+faststart", f45], FF)
        await st.upload(ruta("4x5", "video"), await readFile(f45), "video/mp4")
        out.push({ formato: "9x16", tipo: "video", key: ruta("9x16", "video") }, { formato: "4x5", tipo: "video", key: ruta("4x5", "video") })
      }

      if (formato !== "video") {
        // Imagen: la primera foto de la versión (si solo hay videos, un cuadro del video) con el texto de la marca.
        const i = Math.max(0, usa.findIndex((m) => m.tipo === "foto"))
        const plantilla = ["banda", "etiqueta"].includes(defaultTemplate(marca.slug)) ? defaultTemplate(marca.slug) : "banda"
        for (const [f, ancho, alto] of [["9x16", 1080, 1920], ["4x5", 1080, 1350]] as const) {
          const foto = await encuadrar(archivos[i].archivo, ancho, alto, usa[i].tipo === "video", dir, `foto-${f}.jpg`)
          const capa = await renderOverlay({ brand: marca.slug, template: plantilla, text: texto, subtitle: segundo, width: ancho, height: alto, story: f === "9x16", custom })
          if (!capa) throw new PermanentError(`la marca ${marca.slug} no tiene plantilla para escribir el texto`)
          await st.upload(ruta(f, "imagen"), await compositePhoto(foto, capa, dir), "image/jpeg")
          out.push({ formato: f, tipo: "imagen", key: ruta(f, "imagen") })
        }
      }
      return out
    })
    await db.from("cos_ad_set_versiones").update({ piezas, estado: "lista", error: null }).eq("id", id)
    log("ads:set-version lista", { set: set.id, version: v.numero, piezas: piezas.length })
  } catch (e) {
    const ultimo = job.attempts >= (job.max_attempts ?? 5) - 1
    if (!(e instanceof PermanentError) && !ultimo) throw e
    await db.from("cos_ad_set_versiones").update({ estado: "error", error: String((e as Error).message).slice(0, 400) }).eq("id", id)
  }
  await cerrarSiTermino(db, set.id)
}

export const adSetHandlers: Record<string, Handler> = {
  "ads:set": prepararSet,
  "ads:set-version": armarVersion,
}

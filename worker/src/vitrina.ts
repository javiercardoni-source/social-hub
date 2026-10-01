/**
 * F11 · Motor de Vitrinas (docs/PLAN-MOTOR-VITRINAS.md).
 *
 *   vitrina:build  (vitrina_id)  junta los anuncios (de una campaña de Meta o de una tanda del Motor
 *                                de ADS), prepara cada video en dos versiones (para mirar y para
 *                                compartir) + portada en cos-media, deja la vitrina «lista» y rota:
 *                                quedan las últimas N de la marca, las demás se retiran (su link
 *                                redirige a la vigente) y se borran sus archivos.
 *   vitrina:turnos (vitrina_id)  V2: avisa al equipo en Turnos (historia) cuando Javier la aprueba.
 *
 * Solo LEE Meta. Nunca prende, pausa ni cambia nada allá.
 */
import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Handler } from "./handlers.ts"
import { PermanentError } from "./queue.ts"
import { graph, tokenFor } from "./meta.ts"
import { supabaseStorage } from "./storage.ts"
import { probe, withTmp, writeTmp } from "./media.ts"
import { AD_FIELDS, anuncio, asegurarMedios, filaAnuncio, guardarAnuncios, marcasPorPagina, todas, type AnuncioFila, type AnuncioMeta } from "./ads.ts"
import { aRetirar, chipOferta, mensajeWhatsApp, nombreAnuncio, textoProhibido } from "../../shared/cos/vitrina.ts"

const run = promisify(execFile)
const ff = (args: string[]) => run("ffmpeg", ["-loglevel", "error", "-y", ...args], { timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 })

type Vitrina = { id: string; brand_id: string; estado: string; origen: "campaña" | "motor"; meta_campaign_id: string | null; proposal_week: string | null }
type Fuente = {
  ad_id: string | null
  nombre: string
  titulo: string
  cuerpo: string
  cta: string | null
  mensaje_wa: string | null
  permalink: string | null
  origen_ia: boolean
  /** Video (o imagen) de origen en cos-media. */
  key: string | null
  tipo: "video" | "imagen"
}

/** Los anuncios de una campaña de Meta (los vivos), de la marca de la vitrina. */
async function desdeCampaña(db: SupabaseClient, v: Vitrina, log: (m: string, e?: Record<string, unknown>) => void): Promise<Fuente[]> {
  const token = tokenFor("META_ADS_TOKEN")
  const ads = await todas<AnuncioMeta>(`${v.meta_campaign_id}/ads`, token, { fields: AD_FIELDS, limit: "50" })
  if (!ads.length) throw new PermanentError("la campaña no tiene anuncios (¿el ID es de una campaña?)")
  // La cuenta publicitaria sale de la campaña.
  const { data: cuentas } = await db.from("cos_ad_accounts").select("id")
  const camp = await graph<{ account_id?: string }>("GET", v.meta_campaign_id!, token, { fields: "account_id" })
  const acc = `act_${camp.account_id}`
  if (!(cuentas ?? []).some((c) => c.id === acc)) throw new PermanentError(`la cuenta ${acc} no está en Content OS (cos_ad_accounts)`)
  const m = await marcasPorPagina(db)
  const vivos = ads.filter((a) => !["DELETED", "ARCHIVED"].includes(a.effective_status ?? ""))
  await guardarAnuncios(db, vivos.map((a) => filaAnuncio(a, acc, m)))
  const out: Fuente[] = []
  for (const meta of vivos) {
    let a = await anuncio(db, meta.id)
    if (a.brand_id && a.brand_id !== v.brand_id) {
      log("vitrina: anuncio de otra marca, se saltea", { ad: a.id })
      continue
    }
    a = await asegurarMedios(db, a, true)
    out.push(fuenteDeAnuncio(a))
  }
  return out
}

function fuenteDeAnuncio(a: AnuncioFila & { revision?: { ia_generada?: boolean } | null }): Fuente {
  return {
    ad_id: a.id,
    nombre: a.name ?? "",
    titulo: a.title ?? "",
    cuerpo: a.body ?? "",
    cta: a.cta_type,
    mensaje_wa: mensajeWhatsApp(a.welcome_message),
    permalink: a.permalink,
    origen_ia: !!a.revision?.ia_generada,
    key: a.video_key ?? a.thumb_key,
    tipo: a.video_key ? "video" : "imagen",
  }
}

/** Los anuncios que el Motor de ADS creó esa semana para la marca (uno por propuesta, el 9:16). */
async function desdeMotor(db: SupabaseClient, v: Vitrina): Promise<Fuente[]> {
  const { data: props } = await db
    .from("cos_ad_proposals")
    .select("id, title, body, cta_type, pieces, numeros, meta")
    .eq("brand_id", v.brand_id)
    .eq("week", v.proposal_week!)
    .eq("status", "creada")
    .order("created_at")
  const out: Fuente[] = []
  for (const p of props ?? []) {
    const pieces = (p.pieces ?? []) as { formato: string; tipo: "video" | "imagen"; key: string | null }[]
    const pz = pieces.find((x) => x.formato === "9x16") ?? pieces[0]
    const ads = ((p.meta ?? {}) as { ads?: Record<string, string> }).ads ?? {}
    const adId = ads["9x16"] ?? Object.values(ads)[0] ?? null
    const fila = adId ? ((await db.from("cos_ads").select("permalink").eq("id", adId).maybeSingle()).data as { permalink: string | null } | null) : null
    out.push({
      ad_id: adId,
      nombre: p.title as string,
      titulo: p.title as string,
      cuerpo: p.body as string,
      cta: p.cta_type as string | null,
      mensaje_wa: null,
      permalink: fila?.permalink ?? null,
      origen_ia: !!(p.numeros as { origen_ia?: boolean } | null)?.origen_ia,
      key: pz?.key ?? null,
      tipo: pz?.tipo ?? "video",
    })
  }
  return out
}

const build: Handler = async (job, { db, log }) => {
  const id = String(job.payload.vitrina_id ?? "")
  const { data: v } = await db.from("cos_vitrinas").select("id, brand_id, estado, origen, meta_campaign_id, proposal_week").eq("id", id).maybeSingle()
  if (!v) throw new PermanentError(`vitrina ${id}: no existe`)
  const vit = v as Vitrina
  if (vit.estado === "retirada") return
  const st = supabaseStorage(db)
  try {
    const fuentes = (vit.origen === "campaña" ? await desdeCampaña(db, vit, log) : await desdeMotor(db, vit)).filter((f) => {
      if (textoProhibido(`${f.titulo} ${f.cuerpo}`)) {
        log("vitrina: anuncio con «sin TACC / gluten», no entra", { ad: f.ad_id })
        return false
      }
      return !!f.key
    })
    if (!fuentes.length) throw new PermanentError("no quedó ningún anuncio con video o imagen para mostrar")

    const items = await withTmp(async (dir) => {
      const out: Record<string, unknown>[] = []
      for (const [i, f] of fuentes.entries()) {
        const base = `vitrinas/${vit.id}/${i}`
        const src = await writeTmp(dir, `src${i}${f.tipo === "video" ? ".mp4" : ".jpg"}`, await st.download(f.key!))
        let video_key: string | null = null
        let share_key: string
        const poster = join(dir, `tapa${i}.jpg`)
        if (f.tipo === "video") {
          const dur = ((await probe(src, "video/mp4")).durationMs ?? 2000) / 1000
          // Para mirar: liviano y mudo (arranca solo). Para compartir: 720p con sonido.
          const ver = join(dir, `ver${i}.mp4`)
          const comp = join(dir, `comp${i}.mp4`)
          await ff(["-i", src, "-an", "-vf", "scale=-2:'min(960,ih)',fps=30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-threads", "2", "-movflags", "+faststart", ver])
          await ff(["-i", src, "-vf", "scale=-2:'min(1280,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-threads", "2", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", comp])
          await ff(["-ss", String(Math.min(1, dur / 2)), "-i", src, "-frames:v", "1", "-vf", "scale=-2:'min(960,ih)'", "-q:v", "4", poster])
          await st.upload(`${base}-ver.mp4`, await readFile(ver), "video/mp4")
          await st.upload(`${base}-compartir.mp4`, await readFile(comp), "video/mp4")
          video_key = `${base}-ver.mp4`
          share_key = `${base}-compartir.mp4`
        } else {
          await ff(["-i", src, "-vf", "scale='min(1080,iw)':-2", "-q:v", "3", poster])
          share_key = `${base}-tapa.jpg`
        }
        await st.upload(`${base}-tapa.jpg`, await readFile(poster), "image/jpeg")
        out.push({
          vitrina_id: vit.id,
          orden: i,
          ad_id: f.ad_id,
          nombre: nombreAnuncio(f.nombre, i),
          titulo: f.titulo,
          cuerpo: f.cuerpo,
          chip: chipOferta(f.titulo),
          cta: f.cta,
          mensaje_wa: f.mensaje_wa,
          video_key,
          share_key,
          poster_key: `${base}-tapa.jpg`,
          permalink: f.permalink,
          origen_ia: f.origen_ia,
        })
      }
      return out
    })
    // Re-armar reemplaza los ítems (los archivos se pisan con el mismo nombre).
    await db.from("cos_vitrina_items").delete().eq("vitrina_id", vit.id)
    const { error } = await db.from("cos_vitrina_items").insert(items)
    if (error) throw new Error(`cos_vitrina_items: ${error.message}`)
    await db.from("cos_vitrinas").update({ estado: vit.estado === "aprobada" ? "aprobada" : "lista", error: null, updated_at: new Date().toISOString() }).eq("id", vit.id)
    log("vitrina lista", { vitrina: vit.id, anuncios: items.length })
    await rotar(db, vit.brand_id, vit.id, log)
  } catch (e) {
    if (e instanceof PermanentError || (e as { meta?: unknown }).meta) {
      await db.from("cos_vitrinas").update({ estado: "error", error: String((e as Error).message).slice(0, 400), updated_at: new Date().toISOString() }).eq("id", vit.id)
      return
    }
    throw e
  }
}

/** Quedan las últimas N de la marca; las demás se retiran (link → vigente) y se borran sus archivos. */
async function rotar(db: SupabaseClient, brandId: string, nueva: string, log: (m: string, e?: Record<string, unknown>) => void) {
  const { data: marca } = await db.from("cos_brands").select("vitrinas_max").eq("id", brandId).single()
  const { data: vs } = await db.from("cos_vitrinas").select("id, estado, created_at, approved_at").eq("brand_id", brandId)
  const fuera = aRetirar((vs ?? []) as never, (marca?.vitrinas_max as number) ?? 6, nueva)
  for (const id of fuera) {
    const { data: its } = await db.from("cos_vitrina_items").select("video_key, share_key, poster_key").eq("vitrina_id", id)
    const keys = (its ?? []).flatMap((x) => [x.video_key, x.share_key, x.poster_key]).filter(Boolean) as string[]
    if (keys.length) await db.storage.from("cos-media").remove(keys)
    await db.from("cos_vitrinas").update({ estado: "retirada", retired_at: new Date().toISOString() }).eq("id", id)
    log("vitrina retirada (rotación)", { vitrina: id, archivos: keys.length })
  }
}

// ── V2 · Aviso al equipo en Turnos ─────────────────────────────────────────

/**
 * Turnos no tiene (todavía) una API para recibir avisos de Content OS: la historia se publica
 * escribiendo en SU base, igual que lo hace Turnos con publicarComunicado (lib/historias-sistema.ts):
 * archivo en el bucket `stories` + fila en `stories` con system_sender 'kitchco' y un sticker de link.
 * Se apaga sola si faltan TURNOS_SUPABASE_URL / TURNOS_SUPABASE_SERVICE_KEY.
 */
export function turnosDb(): SupabaseClient | null {
  const url = process.env.TURNOS_SUPABASE_URL
  const key = process.env.TURNOS_SUPABASE_SERVICE_KEY
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null
}
const VITRINA_URL = () => (process.env.VITRINA_URL ?? "https://vitrina.kitchcocenter.com").replace(/\/$/, "")
/** Token opaco por persona (va en el link): con él se cuentan los compartidos de cada uno. */
const tokenEmpleado = (userId: string) => createHash("sha256").update(`vitrina:${userId}`).digest("base64url").slice(0, 12)

const turnos: Handler = async (job, { db, log }) => {
  const id = String(job.payload.vitrina_id ?? "")
  const t = turnosDb()
  const { data: v } = await db.from("cos_vitrinas").select("id, slug, titulo, estado, brand_id, turnos_at, cos_brands(slug, name)").eq("id", id).maybeSingle()
  if (!v) throw new PermanentError(`vitrina ${id}: no existe`)
  if (v.estado !== "aprobada" || v.turnos_at) return
  if (!t) {
    await db.from("cos_vitrinas").update({ turnos_error: "Turnos no está conectado (faltan TURNOS_SUPABASE_URL / TURNOS_SUPABASE_SERVICE_KEY)" }).eq("id", id)
    return
  }
  const marca = v.cos_brands as unknown as { slug: string; name: string }
  try {
    // Cocinas de la marca y su gente activa.
    const { data: cocinas, error: e1 } = await t.from("kitchens").select("id, company_id").contains("brand_slugs", [marca.slug])
    if (e1) throw new Error(`Turnos kitchens: ${e1.message}`)
    if (!cocinas?.length) throw new PermanentError(`en Turnos no hay cocinas de ${marca.slug}`)
    const { data: gente, error: e2 } = await t.from("users").select("id, name, company_id").eq("active", true).in("kitchen_id", cocinas.map((c) => c.id))
    if (e2) throw new Error(`Turnos users: ${e2.message}`)
    const { data: javier } = await t.from("users").select("id").eq("email", process.env.TURNOS_AUTOR_EMAIL ?? "javiercardoni@gmail.com").maybeSingle()
    if (!javier) throw new PermanentError("no encuentro el usuario de Javier en Turnos (autor de la historia)")

    // La portada del primer anuncio como foto de la historia.
    const { data: item } = await db.from("cos_vitrina_items").select("poster_key").eq("vitrina_id", id).order("orden").limit(1).maybeSingle()
    if (!item?.poster_key) throw new PermanentError("la vitrina no tiene portada")
    const foto = await supabaseStorage(db).download(item.poster_key as string)

    const ahora = Date.now()
    const mapa: Record<string, string> = {}
    for (const u of gente ?? []) {
      const tok = tokenEmpleado(u.id as string)
      mapa[tok] = (u.name as string) ?? "?"
      // Reintento: a quien ya le llegó no se le manda otra.
      const { data: ya } = await t.from("stories").select("id").like("storage_path", `sistema/vitrinas/${v.id}/%`).contains("audience_user_ids", [u.id]).limit(1)
      if (ya?.length) continue
      const sid = randomUUID()
      const path = `sistema/vitrinas/${v.id}/${sid}.jpg`
      const up = await t.storage.from("stories").upload(path, foto, { contentType: "image/jpeg", upsert: true })
      if (up.error) throw new Error(`Turnos stories (archivo): ${up.error.message}`)
      const link = `${VITRINA_URL()}/${marca.slug}/${v.slug}/?e=${tok}`
      const { error } = await t.from("stories").insert({
        id: sid,
        company_id: u.company_id,
        created_by: javier.id,
        kind: "image",
        storage_path: path,
        poster_path: null,
        mime: "image/jpeg",
        size_bytes: foto.length,
        duration_ms: 15_000,
        status: "ready",
        audience_user_ids: [u.id],
        audience_kind: "all",
        published_at: new Date(ahora).toISOString(),
        expires_at: new Date(ahora + 48 * 3600_000).toISOString(),
        until_seen: true,
        edits: {
          v: 1,
          frame: { scale: 1, x: 0, y: 0, rotation: 0 },
          bg: ["#1f2937", "#111827"],
          filter: { id: "normal", intensity: 1 },
          trim: null,
          muted: false,
          stickers: [{ id: "vitrina", type: "link", x: 0.5, y: 0.82, scale: 1.1, rotation: 0, url: link, label: "Ver y compartir los anuncios" }],
        },
        overlay_path: null,
        system_sender: "kitchco",
        system_title: `Anuncios ${marca.name}`,
      })
      if (error) throw new Error(`Turnos stories: ${error.message}`)
    }

    // Link fijo en Enlaces de cada cocina de la marca (una vez).
    const fijo = `${VITRINA_URL()}/${marca.slug}/`
    for (const c of cocinas) {
      const { data: ya } = await t.from("portal_links").select("id").eq("url", fijo).eq("kitchen_id", c.id).maybeSingle()
      if (!ya) await t.from("portal_links").insert({ name: `Anuncios ${marca.name} (para compartir)`, url: fijo, description: "Los anuncios vigentes de la marca, listos para subir a tu Instagram", access: "public", kitchen_id: c.id, sort_order: 0, active: true })
    }
    await db.from("cos_vitrinas").update({ turnos_at: new Date().toISOString(), turnos_error: null, turnos_gente: mapa }).eq("id", id)
    log("vitrina avisada en Turnos", { vitrina: id, personas: Object.keys(mapa).length })
  } catch (e) {
    if (e instanceof PermanentError) {
      await db.from("cos_vitrinas").update({ turnos_error: e.message }).eq("id", id)
      return
    }
    throw e
  }
}

export const vitrinaHandlers: Record<string, Handler> = { "vitrina:build": build, "vitrina:turnos": turnos }

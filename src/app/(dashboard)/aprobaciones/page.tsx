import { requireMember } from "@/lib/cos/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrls } from "@/lib/cos/storage"
import { getActiveBrand } from "@/lib/cos/brand"
import { suggestionsFor } from "@/lib/cos/analytics"
import { liftText } from "../../../../shared/cos/timing"
import { lineaDeTiempo, normalizarExcluidos, type GuionReel } from "../../../../shared/cos/reel"
import { leerDiseno, plantilla, plantillasDe, textoDiseno } from "../../../../shared/cos/plantillas"
import { PageHeader } from "@/components/dashboard/page-header"
import { ListaAprobaciones, Preparando, type Grupo } from "./aprobaciones-client"

export const dynamic = "force-dynamic"

type RawPost = {
  id: string
  account_id: string
  brand_id: string
  caption: string
  hashtags: string
  platform: "instagram" | "facebook"
  post_type: "feed" | "carousel" | "reel" | "story"
  scheduled_at: string | null
  created_at: string
  overlay_text: string
  template: string
  diseno: unknown
  tapa_key: string | null
  render_key: string | null
  music_key: string | null
  overlay_position: "auto" | "top" | "bottom"
  render_qa: { ok?: boolean; tapa?: string; legible?: boolean; skipped?: string } | null
  first_render_at: string | null
  campaign: string | null
  montaje: (GuionReel & { respaldo?: boolean }) | null
  window_start: string | null
  schedule_source: string | null
  schedule_reason: string | null
  schedule_lock: boolean
  pick_json: { porque?: string; elegido?: string; final?: string; override?: unknown } | null
  cos_brands: { name: string; color: string; slug: string; plantillas: string[] | null } | null
  cos_social_accounts: { display_name: string } | null
  cos_post_media: {
    position: number
    cos_asset_versions: {
      id: string
      excluir: [number, number][] | null
      storage_key: string | null
      mime: string | null
      width: number | null
      height: number | null
      cos_assets: {
        id: string
        thumb_key: string | null
        submitted_by_label: string | null
        description: string | null
        quality_score: number | null
        ai_json: { risk_flags?: string[] } | null
      } | null
    } | null
  }[]
}

// Orden en que se muestran los formatos dentro de una misma subida.
const ORDER = ["instagram:feed", "instagram:reel", "instagram:carousel", "instagram:story", "facebook:feed", "facebook:reel"]

/**
 * Plantilla propia de la pieza y las que se pueden elegir. Fotos (post e historia) y la tapa de
 * los reels de Instagram; la historia-video de un reel no lleva.
 */
function disenoDe(p: RawPost, esVideo: boolean) {
  const slug = p.cos_brands?.slug ?? ""
  const d = leerDiseno(p.diseno, slug)
  const reelIg = !!p.montaje && p.post_type === "reel" && p.platform === "instagram"
  const fotoIg = !p.montaje && !esVideo && p.platform === "instagram" && (p.post_type === "feed" || p.post_type === "story")
  const opciones = reelIg || fotoIg ? plantillasDe(slug, p.post_type === "story" ? "story" : "feed", p.cos_brands?.plantillas ?? []) : []
  return {
    diseno: d ? { plantilla: d.plantilla, nombre: plantilla(d.plantilla)?.nombre ?? d.plantilla, texto: textoDiseno(d) } : null,
    plantillas: opciones.map((x) => ({ id: x.id, nombre: x.nombre, para: x.para })),
  }
}

/** ¿Pasaron más de `min` minutos desde `iso`? (fuera del componente: la hora actual no es "pura") */
function haceMasDe(iso: string, min: number) {
  return Date.now() - new Date(iso).getTime() > min * 60_000
}

export default async function AprobacionesPage() {
  await requireMember("approver")
  const db = createAdminClient()
  const brand = await getActiveBrand()

  let query = db
    .from("cos_posts")
    .select(`
      id, account_id, brand_id, caption, hashtags, platform, post_type, scheduled_at, created_at, overlay_text, template, diseno, tapa_key, render_key, music_key, overlay_position, render_qa, first_render_at, campaign, montaje, window_start, schedule_source, schedule_reason, schedule_lock, pick_json,
      cos_brands(name, color, slug, plantillas),
      cos_social_accounts(display_name),
      cos_post_media(
        position,
        cos_asset_versions(
          id, excluir, storage_key, mime, width, height,
          cos_assets!cos_asset_versions_asset_id_fkey(id, thumb_key, submitted_by_label, description, quality_score, ai_json)
        )
      )
    `)
    .eq("status", "PENDING_APPROVAL")
    .order("created_at", { ascending: true })
  if (brand) query = query.eq("brand_id", brand.id)
  const { data, error } = await query
  // Mejor un error a la vista que una bandeja vacía que miente.
  if (error) throw new Error(`No se pudieron cargar las aprobaciones: ${error.message}`)
  const posts = (data ?? []) as unknown as RawPost[]

  // La vista previa usa el archivo original (no la miniatura) para mostrarlo tal cual sale.
  const keys = [
    ...posts.flatMap((p) => p.cos_post_media.map((m) => m.cos_asset_versions?.storage_key).filter(Boolean) as string[]),
    ...(posts.map((p) => p.render_key).filter(Boolean) as string[]),
    ...(posts.map((p) => p.tapa_key).filter(Boolean) as string[]),
  ]
  const urls = await signedUrls(keys, 3 * 3600)

  // Biblioteca de música de cada marca que aparece (para elegir el tema de los reels).
  const slugs = [...new Set(posts.map((p) => p.cos_brands?.slug).filter(Boolean) as string[])]
  const musicBySlug: Record<string, { key: string; name: string; url: string | null }[]> = {}
  for (const slug of slugs) {
    const { data: files } = await db.storage.from("cos-media").list(`music/${slug}`, { limit: 100 })
    const keys = (files ?? []).filter((f) => /\.(mp3|m4a|wav|aac)$/i.test(f.name)).map((f) => `music/${slug}/${f.name}`)
    const signed = await signedUrls(keys, 3 * 3600)
    musicBySlug[slug] = keys.map((k) => ({ key: k, name: k.split("/").pop()!.replace(/\.[a-z0-9]+$/, "").replace(/-/g, " "), url: signed[k] ?? null }))
  }

  // Mejores horarios según lo que ya rindió cada cuenta en cada formato (motor F1).
  const sugerencias = await suggestionsFor(
    db,
    [...new Map(posts.map((p) => [`${p.account_id}:${p.post_type}`, { accountId: p.account_id, brandId: p.brand_id, format: p.post_type }])).values()],
  ).catch((e) => {
    // Sin sugerencias se puede aprobar igual; el error queda en el log del servidor.
    console.error("sugerencias de horario:", e)
    return {} as Awaited<ReturnType<typeof suggestionsFor>>
  })

  // Una subida se muestra recién cuando todas sus piezas finales estuvieron listas alguna vez
  // (así no aparece "a medio editar"). Si algo se traba más de 10 min, se muestra igual.
  const preparando = new Set<string>()
  // Mientras su armado esté en la cola, no está trabado: solo espera turno (con la cola larga puede
  // tardar horas). Sin nada en la cola y más de 10 min, sí: se muestra para no perderlo de vista.
  const { data: enCola } = await db.from("cos_jobs").select("payload").in("type", ["post:render", "post:disenar", "post:redo"]).in("status", ["queued", "running"])
  const esperando = new Set(
    (enCola ?? []).flatMap((j) => {
      const pl = j.payload as { post_id?: string; post_ids?: string[] }
      return [...(pl.post_id ? [pl.post_id] : []), ...(pl.post_ids ?? [])]
    }),
  )
  const trabado = (p: (typeof posts)[number]) => !esperando.has(p.id) && haceMasDe(p.created_at, 10)
  for (const p of posts) {
    const k = [...p.cos_post_media].sort((a, b) => a.position - b.position)[0]?.cos_asset_versions?.cos_assets?.id ?? p.id
    if ((!p.first_render_at || !p.render_key) && !trabado(p)) preparando.add(k)
  }

  const grupos = new Map<string, Grupo>()
  for (const p of posts) {
    const media = [...p.cos_post_media].sort((a, b) => a.position - b.position)[0]
    const v = media?.cos_asset_versions
    const asset = v?.cos_assets
    const key = asset?.id ?? p.id
    if (preparando.has(key)) continue
    if (!grupos.has(key)) {
      grupos.set(key, {
        key,
        brand: p.cos_brands ? { name: p.cos_brands.name, color: p.cos_brands.color } : null,
        mediaUrl: v?.storage_key ? (urls[v.storage_key] ?? null) : null,
        isVideo: !!v?.mime?.startsWith("video/"),
        width: v?.width ?? null,
        height: v?.height ?? null,
        description: asset?.description ?? null,
        submittedBy: asset?.submitted_by_label ?? null,
        quality: asset?.quality_score ?? null,
        riskFlags: asset?.ai_json?.risk_flags ?? [],
        music: musicBySlug[p.cos_brands?.slug ?? ""] ?? [],
        createdAt: p.created_at,
        posts: [],
      })
    }
    grupos.get(key)!.posts.push({
      id: p.id,
      caption: p.caption,
      hashtags: p.hashtags,
      platform: p.platform,
      postType: p.post_type,
      scheduledAt: p.scheduled_at,
      campaign: p.campaign,
      overlayText: p.overlay_text,
      musicKey: p.music_key,
      position: p.overlay_position,
      qa: p.render_qa,
      suggestions: (sugerencias[`${p.account_id}:${p.post_type}`]?.slots ?? []).map((x) => ({
        at: x.at,
        label: x.label,
        lift: liftText(x.lift),
        up: x.lift >= 1,
        confianza: x.confianza,
      })),
      template: p.template,
      ...disenoDe(p, !!v?.mime?.startsWith("video/")),
      tapaUrl: p.tapa_key ? (urls[p.tapa_key] ?? null) : null,
      // Videos originales del reel: para ver qué partes usó el motor y marcar las que no se usan.
      videosFuente: p.montaje
        ? [...p.cos_post_media]
            .sort((a, b) => a.position - b.position)
            .map((m, i) => ({ m, i }))
            .filter(({ m }) => m.cos_asset_versions?.mime?.startsWith("video/") && m.cos_asset_versions.storage_key)
            .map(({ m, i }) => ({
              versionId: m.cos_asset_versions!.id,
              url: urls[m.cos_asset_versions!.storage_key!] ?? null,
              excluir: normalizarExcluidos(m.cos_asset_versions!.excluir),
              usadas: (p.montaje!.tomas ?? []).filter((t) => t.fuente === i).map((t) => [t.trim_start, t.trim_start + t.duracion] as [number, number]),
            }))
        : [],
      // Por qué este tema (F7 M2), mientras siga siendo el que eligió el motor.
      musicaPorque: p.pick_json?.porque && !p.pick_json.override && [p.pick_json.final, p.pick_json.elegido].includes(p.music_key ?? "") ? p.pick_json.porque : null,
      // Horario que eligió la agenda (F8): se aprueba con su ventana.
      motor:
        p.scheduled_at && p.window_start && !p.schedule_lock && ["motor", "exploracion", "fijo"].includes(p.schedule_source ?? "")
          ? { at: p.scheduled_at, porque: p.schedule_reason ?? "", prueba: p.schedule_source === "exploracion", fijo: p.schedule_source === "fijo" }
          : null,
      // Reel armado por el motor (F9): lo que Javier necesita para entender la elección.
      reel: p.montaje
        ? {
            idea: p.montaje.idea ?? "",
            segundos: Math.round(lineaDeTiempo(p.montaje.tomas ?? [], p.montaje.ritmo).total),
            tomas: (p.montaje.tomas ?? []).map((t) => ({ porQue: t.por_que ?? "", segundos: t.duracion, fuente: t.fuente })),
            fuentes: p.cos_post_media.length,
            respaldo: !!p.montaje.respaldo,
            precio: p.montaje.cierre?.precio ?? null,
          }
        : null,
      renderUrl: p.render_key ? (urls[p.render_key] ?? null) : null,
      accountName: p.cos_social_accounts?.display_name ?? p.cos_brands?.name ?? "",
    })
  }
  const lista = [...grupos.values()].map((g) => ({
    ...g,
    posts: g.posts.sort((a, b) => ORDER.indexOf(`${a.platform}:${a.postType}`) - ORDER.indexOf(`${b.platform}:${b.postType}`)),
  }))

  return (
    <>
      <PageHeader
        title="Aprobaciones"
        description={
          posts.length > 0
            ? `${posts.length} publicación${posts.length !== 1 ? "es" : ""} esperando tu OK${brand ? ` · ${brand.name}` : ""}`
            : "Sin publicaciones pendientes"
        }
      />
      <div className="p-4 md:p-6">
        {preparando.size > 0 && <Preparando cantidad={preparando.size} />}
        <ListaAprobaciones grupos={lista} />
      </div>
    </>
  )
}

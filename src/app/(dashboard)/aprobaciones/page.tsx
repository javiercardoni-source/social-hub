import { requireMember } from "@/lib/cos/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrls } from "@/lib/cos/storage"
import { getActiveBrand } from "@/lib/cos/brand"
import { PageHeader } from "@/components/dashboard/page-header"
import { ListaAprobaciones, type Grupo } from "./aprobaciones-client"

export const dynamic = "force-dynamic"

type RawPost = {
  id: string
  caption: string
  hashtags: string
  platform: "instagram" | "facebook"
  post_type: "feed" | "carousel" | "reel" | "story"
  scheduled_at: string | null
  created_at: string
  overlay_text: string
  template: string
  render_key: string | null
  music_key: string | null
  cos_brands: { name: string; color: string; slug: string } | null
  cos_social_accounts: { display_name: string } | null
  cos_post_media: {
    position: number
    cos_asset_versions: {
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

export default async function AprobacionesPage() {
  await requireMember("approver")
  const db = createAdminClient()
  const brand = await getActiveBrand()

  let query = db
    .from("cos_posts")
    .select(`
      id, caption, hashtags, platform, post_type, scheduled_at, created_at, overlay_text, template, render_key, music_key,
      cos_brands(name, color, slug),
      cos_social_accounts(display_name),
      cos_post_media(
        position,
        cos_asset_versions(
          storage_key, mime, width, height,
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

  const grupos = new Map<string, Grupo>()
  for (const p of posts) {
    const media = [...p.cos_post_media].sort((a, b) => a.position - b.position)[0]
    const v = media?.cos_asset_versions
    const asset = v?.cos_assets
    const key = asset?.id ?? p.id
    if (!grupos.has(key)) {
      grupos.set(key, {
        key,
        brand: p.cos_brands,
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
      overlayText: p.overlay_text,
      musicKey: p.music_key,
      template: p.template,
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
        <ListaAprobaciones grupos={lista} />
      </div>
    </>
  )
}

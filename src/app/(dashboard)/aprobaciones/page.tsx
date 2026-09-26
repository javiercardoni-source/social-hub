import { requireMember } from "@/lib/cos/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrls } from "@/lib/cos/storage"
import { PageHeader } from "@/components/dashboard/page-header"
import { ListaAprobaciones } from "./aprobaciones-client"

export const dynamic = "force-dynamic"

export default async function AprobacionesPage() {
  await requireMember("approver")
  const db = createAdminClient()

  // Posts en PENDING_APPROVAL con datos del asset para la miniatura
  const { data: posts } = await db
    .from("cos_posts")
    .select(`
      id, caption, hashtags, platform, post_type, scheduled_at, created_at,
      cos_brands(name, color),
      cos_post_media(
        position,
        cos_asset_versions(
          cos_assets(thumb_key, submitted_by_label)
        )
      )
    `)
    .eq("status", "PENDING_APPROVAL")
    .order("created_at", { ascending: true })

  type RawPost = {
    id: string
    caption: string
    hashtags: string
    platform: string
    post_type: string
    scheduled_at: string | null
    created_at: string
    cos_brands: { name: string; color: string } | null
    cos_post_media: { position: number; cos_asset_versions: { cos_assets: { thumb_key: string | null; submitted_by_label: string | null } | null } | null }[]
  }
  const rawPosts = (posts ?? []) as unknown as RawPost[]

  // Recolectar thumb_keys para firmar
  const thumbKeys: string[] = []
  for (const post of rawPosts) {
    const first = post.cos_post_media?.find((m) => m.position === 0)
    const thumbKey = first?.cos_asset_versions?.cos_assets?.thumb_key
    if (thumbKey) thumbKeys.push(thumbKey)
  }
  const thumbMap = await signedUrls(thumbKeys)

  // Mapear a la forma que espera el componente cliente
  const items = rawPosts.map((post) => {
    const first = post.cos_post_media?.find((m) => m.position === 0)
    const asset = first?.cos_asset_versions?.cos_assets
    const thumbKey = asset?.thumb_key ?? null
    return {
      id: post.id,
      caption: post.caption,
      hashtags: post.hashtags,
      platform: post.platform,
      post_type: post.post_type,
      scheduled_at: post.scheduled_at,
      created_at: post.created_at,
      brand: post.cos_brands ?? null,
      thumbUrl: thumbKey ? (thumbMap[thumbKey] ?? null) : null,
      submittedBy: asset?.submitted_by_label ?? null,
    }
  })

  return (
    <>
      <PageHeader
        title="Aprobaciones"
        description={
          items.length > 0
            ? `${items.length} post${items.length !== 1 ? "s" : ""} esperando tu revisión`
            : "Sin posts pendientes"
        }
      />
      <div className="p-6">
        <ListaAprobaciones posts={items} />
      </div>
    </>
  )
}

import { createAdminClient } from "@/lib/supabase/admin"
import { getActiveBrand } from "@/lib/cos/brand"
import { SidebarClient } from "./sidebar-client"

export type Brand = {
  id: string
  name: string
  slug: string
  color: string
}

export async function Sidebar() {
  const db = createAdminClient()
  const active = await getActiveBrand()
  const byBrand = <Q,>(q: Q): Q => (active ? (q as unknown as { eq: (c: string, v: string) => Q }).eq("brand_id", active.id) : q)

  const [brandsResult, pendingResult, mediaResult, settingsResult, adsResult] = await Promise.all([
    db.from("cos_brands").select("id, name, slug, color").eq("active", true).order("name"),
    byBrand(db.from("cos_posts").select("*", { count: "exact", head: true }).eq("status", "PENDING_APPROVAL")),
    byBrand(db.from("cos_assets").select("*", { count: "exact", head: true }).in("status", ["NEW", "VALIDATING", "READY"]).is("review_status", null)),
    db.from("cos_settings").select("global_pause, publish_mode").eq("id", true).single(),
    byBrand(db.from("cos_ad_proposals").select("*", { count: "exact", head: true }).eq("status", "propuesta")),
  ])

  return (
    <SidebarClient
      brands={(brandsResult.data ?? []) as Brand[]}
      activeSlug={active?.slug ?? null}
      pendingCount={pendingResult.count ?? 0}
      mediaCount={mediaResult.count ?? 0}
      adsCount={adsResult.count ?? 0}
      globalPause={settingsResult.data?.global_pause ?? false}
      live={settingsResult.data?.publish_mode === "live"}
    />
  )
}

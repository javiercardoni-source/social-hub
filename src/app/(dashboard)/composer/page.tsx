import Link from "next/link"
import Image from "next/image"
import { redirect } from "next/navigation"
import { requireMember } from "@/lib/cos/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrl, signedUrls } from "@/lib/cos/storage"
import { PageHeader } from "@/components/dashboard/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ComposerClient } from "./composer-client"
import { Image as ImageIcon, Video } from "lucide-react"

export const dynamic = "force-dynamic"

type SearchParams = { asset?: string }

export default async function ComposerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await requireMember("editor")
  const db = createAdminClient()
  const params = await searchParams
  const assetId = params.asset

  // Si viene con asset preseleccionado, mostrar el composer completo
  if (assetId) {
    const { data: asset } = await db
      .from("cos_assets")
      .select("id, description, media_type, quality_score, thumb_key, ai_json, cos_brands(name, color, slug, id)")
      .eq("id", assetId)
      .in("status", ["READY", "IN_USE"])
      .single()

    if (!asset) redirect("/media")

    // Cuentas de la marca del asset (Supabase devuelve el join como array; tomamos el primero)
    const brandRaw = (asset.cos_brands as unknown as { id: string; name: string; color: string }[] | { id: string; name: string; color: string } | null)
    const brandObj = Array.isArray(brandRaw) ? brandRaw[0] : brandRaw
    const brandId = brandObj?.id
    const { data: accounts } = brandId
      ? await db
          .from("cos_social_accounts")
          .select("id, platform, display_name, status")
          .eq("brand_id", brandId)
          .neq("status", "disabled")
          .order("platform")
      : { data: [] }

    const thumbUrl = await signedUrl(asset.thumb_key)
    const brand = brandObj ? { name: brandObj.name, color: brandObj.color } : null

    return (
      <>
        <PageHeader
          title="Compositor"
          description="Revisá el asset, escribí el copy y programá la publicación."
        />
        <ComposerClient
          asset={{
            id: asset.id,
            description: asset.description,
            media_type: asset.media_type,
            quality_score: asset.quality_score,
            thumbUrl,
            brand,
            ai_json: asset.ai_json as { summary?: string; category?: string; mood?: string; suggested_formats?: string[]; missing_context?: string } | null,
          }}
          accounts={accounts ?? []}
        />
      </>
    )
  }

  // Sin asset: mostrar selector de la Biblioteca
  const { data: assets } = await db
    .from("cos_assets")
    .select("id, description, media_type, quality_score, thumb_key, cos_brands(name, color, slug)")
    .in("status", ["READY", "IN_USE"])
    .order("created_at", { ascending: false })
    .limit(24)

  type AssetRow = { id: string; description: string | null; media_type: string | null; quality_score: number | null; thumb_key: string | null; cos_brands: { name: string; color: string; slug: string } | null }
  const rows = (assets ?? []) as unknown as AssetRow[]
  const thumbKeys = rows.map((a) => a.thumb_key).filter(Boolean) as string[]
  const thumbMap = await signedUrls(thumbKeys)

  return (
    <>
      <PageHeader
        title="Compositor"
        description="Elegí un asset de la biblioteca para armar el post."
      />
      <div className="p-6">
        {rows.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed text-center">
            <ImageIcon className="h-10 w-10 text-muted-foreground/30" />
            <div>
              <p className="font-medium">No hay assets listos</p>
              <p className="mt-1 text-sm text-muted-foreground">
                El worker necesita procesar y clasificar los archivos antes de poder publicarlos.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {rows.map((asset) => {
              const thumb = asset.thumb_key ? thumbMap[asset.thumb_key] : null
              const brand = asset.cos_brands
              return (
                <Link
                  key={asset.id}
                  href={`/composer?asset=${asset.id}`}
                  className="group relative overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="relative aspect-square overflow-hidden bg-muted">
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={asset.description ?? "asset"}
                        fill
                        className="object-cover transition-transform group-hover:scale-105"
                        sizes="180px"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        {asset.media_type === "video" ? (
                          <Video className="h-8 w-8 text-muted-foreground/25" />
                        ) : (
                          <ImageIcon className="h-8 w-8 text-muted-foreground/25" />
                        )}
                      </div>
                    )}
                    {brand && (
                      <div
                        className="absolute left-1.5 top-1.5 rounded px-1 py-0.5 text-[10px] font-semibold text-white"
                        style={{ backgroundColor: brand.color + "dd" }}
                      >
                        {brand.name}
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="line-clamp-2 text-xs text-muted-foreground">{asset.description}</p>
                    {asset.quality_score != null && (
                      <p className={`mt-1 text-[10px] font-medium ${asset.quality_score >= 70 ? "text-emerald-600" : asset.quality_score >= 45 ? "text-amber-600" : "text-red-500"}`}>
                        Q{asset.quality_score}
                      </p>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrls } from "@/lib/cos/storage"
import { PageHeader } from "@/components/dashboard/page-header"
import { llevaTexto, normalizarEstilo } from "../../../../shared/cos/grilla"
import { FeedClient, type AnalisisFeed, type Casilla } from "./feed-client"

export const dynamic = "force-dynamic"

/** Cuántas publicaciones ya hechas se muestran debajo de lo programado. */
const PUBLICADAS = 30

type PostRow = {
  id: string
  status: string
  post_type: "feed" | "reel" | "carousel"
  scheduled_at: string | null
  template: string
  overlay_text: string | null
  render_key: string | null
  cos_post_media: { position: number; cos_asset_versions: { cos_assets: { thumb_key: string | null } | null } | null }[]
}

export default async function FeedPage() {
  await requireMember("approver")
  const brand = await getActiveBrand()
  if (!brand) {
    return (
      <>
        <PageHeader title="Feed" description="Cómo va a quedar el perfil de Instagram con lo programado" />
        <div className="p-6">
          <div className="mx-auto max-w-md rounded-xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">
            Elegí una marca en el selector (arriba a la izquierda, o arriba en el celular) para ver su feed.
          </div>
        </div>
      </>
    )
  }

  const db = createAdminClient()
  const { data: acc } = await db.from("cos_social_accounts").select("id, display_name").eq("brand_id", brand.id).eq("platform", "instagram").neq("status", "disabled").limit(1).maybeSingle()
  if (!acc) {
    return (
      <>
        <PageHeader title={`Feed · ${brand.name}`} description="Cómo va a quedar el perfil de Instagram con lo programado" />
        <p className="p-6 text-sm text-muted-foreground">Esta marca no tiene una cuenta de Instagram conectada.</p>
      </>
    )
  }

  const [{ data: media, error: me }, { data: posts, error: pe }, { data: b }] = await Promise.all([
    db
      .from("cos_media")
      .select("id, format, posted_at, thumb_key, permalink, metrics, con_texto")
      .eq("account_id", acc.id)
      .neq("format", "story")
      .order("posted_at", { ascending: false })
      .limit(PUBLICADAS),
    db
      .from("cos_posts")
      .select(
        "id, status, post_type, scheduled_at, template, overlay_text, render_key, cos_post_media(position, cos_asset_versions(cos_assets!cos_asset_versions_asset_id_fkey(thumb_key)))",
      )
      .eq("account_id", acc.id)
      .in("post_type", ["feed", "reel", "carousel"])
      .in("status", ["APPROVED", "SCHEDULED", "PENDING_APPROVAL"])
      .is("deleted_at", null),
    db.from("cos_brands").select("grid_style, feed_analisis, feed_analisis_at").eq("id", brand.id).single(),
  ])
  if (me || pe) throw new Error(`No se pudo cargar el feed: ${(me ?? pe)!.message}`)

  const filas = (posts ?? []) as unknown as PostRow[]
  // Miniatura: la pieza final si es imagen; si es video, la del archivo original (con ícono de reel).
  const thumbDe = (p: PostRow) => [...p.cos_post_media].sort((a, c) => a.position - c.position)[0]?.cos_asset_versions?.cos_assets?.thumb_key ?? null
  const claves = [
    ...(media ?? []).map((m) => m.thumb_key),
    ...filas.map((p) => (p.render_key?.endsWith(".jpg") ? p.render_key : thumbDe(p))),
  ].filter(Boolean) as string[]
  const urls = await signedUrls(claves)

  const casillas: Casilla[] = [
    ...filas.map((p) => {
      const clave = p.render_key?.endsWith(".jpg") ? p.render_key : thumbDe(p)
      return {
        id: p.id,
        estado: p.status === "PENDING_APPROVAL" ? ("pendiente" as const) : ("programado" as const),
        at: p.status === "PENDING_APPROVAL" ? null : (p.scheduled_at ?? new Date().toISOString()),
        formato: p.post_type,
        conTexto: llevaTexto(p.template, p.overlay_text),
        url: clave ? (urls[clave] ?? null) : null,
        permalink: null,
        alcance: null,
      }
    }),
    ...(media ?? []).map((m) => ({
      id: m.id,
      estado: "publicado" as const,
      at: m.posted_at,
      formato: m.format as Casilla["formato"],
      conTexto: m.con_texto,
      url: m.thumb_key ? (urls[m.thumb_key] ?? null) : null,
      permalink: m.permalink,
      alcance: ((m.metrics as Record<string, number> | null)?.reach || (m.metrics as Record<string, number> | null)?.views) ?? null,
    })),
  ]

  return (
    <>
      <PageHeader title={`Feed · ${brand.name}`} description="Cómo va a quedar el perfil de Instagram cuando salga lo programado" />
      <div className="p-4 md:p-6">
        <FeedClient
          brandName={brand.name}
          handle={acc.display_name ?? brand.name}
          color={brand.color}
          casillas={casillas}
          estilo={normalizarEstilo(b?.grid_style)}
          analisis={(b?.feed_analisis as AnalisisFeed | null) ?? null}
          analisisAt={b?.feed_analisis_at ?? null}
        />
      </div>
    </>
  )
}

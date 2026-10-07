import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { createAdminClient } from "@/lib/supabase/admin"
import { cargarAprobaciones } from "@/lib/cos/aprobaciones-datos"
import { AppAprobar, type Tarjeta } from "./app-client"

export const dynamic = "force-dynamic"

/**
 * F12 · App de aprobación en el celular. Una sola pantalla: cada pieza (reel, historia, post o
 * Facebook) se muestra unitariamente, aunque varias salgan de la misma foto. Los datos salen de
 * la misma fuente que la web (lib/cos/aprobaciones-datos.ts): nunca se puede ver algo distinto acá.
 */
export default async function AppAprobarPage() {
  await requireMember("approver", "/app")
  const brand = await getActiveBrand()
  const db = createAdminClient()

  const [{ pendientes, preparando, grupos }, { data: marcasRaw }] = await Promise.all([
    cargarAprobaciones(brand, { soloListas: true }),
    db.from("cos_brands").select("slug, name, color").eq("active", true).order("name"),
  ])

  // Cada pieza de cada subida es su propia tarjeta (pedido de Javier, 07-10): aunque dos salgan de
  // la misma foto (el reel y su historia), se ven y se deciden una por una.
  const tarjetas: Tarjeta[] = grupos.flatMap((g) =>
    g.posts.map((p) => ({
      id: p.id,
      grupoKey: g.key,
      platform: p.platform,
      postType: p.postType,
      caption: p.caption,
      hashtags: p.hashtags,
      overlayText: p.overlayText,
      accountName: p.accountName,
      brand: g.brand,
      renderUrl: p.renderUrl,
      mediaUrl: g.mediaUrl,
      mediaEsVideo: g.isVideo,
      qa: p.qa,
      avisos: p.avisos,
      motor: p.motor,
      musicaPorque: p.musicaPorque,
      reel: p.reel,
      riskFlags: g.riskFlags,
      description: g.description,
      submittedBy: g.submittedBy,
      scheduledAt: p.scheduledAt,
    })),
  )

  return (
    <AppAprobar
      tarjetas={tarjetas}
      pendientes={pendientes}
      preparando={preparando}
      marcaActual={brand?.slug ?? ""}
      marcas={(marcasRaw ?? []) as { slug: string; name: string; color: string }[]}
      vapidKey={process.env.VAPID_PUBLIC_KEY ?? null}
    />
  )
}

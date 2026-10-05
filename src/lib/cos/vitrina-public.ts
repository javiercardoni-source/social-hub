import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { vigente, type VitrinaFila } from "../../../shared/cos/vitrina"

/**
 * F11 · Datos de una vitrina pública (sin sesión). Solo lo que se muestra: anuncios, textos y
 * links firmados a los videos. Nada de gasto, números ni datos de clientes.
 */
export type ItemPublico = {
  id: string
  nombre: string
  titulo: string
  cuerpo: string
  chip: string | null
  cta: string | null
  mensajeWa: string | null
  ver: string | null
  compartir: string | null
  descargar: string | null
  tapa: string | null
  tipo: "video" | "imagen"
  permalink: string | null
  origenIA: boolean
}
export type VitrinaPublica = {
  id: string
  slug: string
  titulo: string
  bajada: string
  marca: { slug: string; nombre: string; color: string; logo: string | null; ig: string | null }
  items: ItemPublico[]
}

const TTL = 6 * 3600

/**
 * La vitrina pedida. `slug` vacío = la vigente de la marca. Una retirada (o inexistente con la
 * marca bien) devuelve { redirigir } a la vigente: ningún link compartido termina en error.
 */
export async function cargarVitrina(marcaSlug: string, slug: string | null): Promise<{ vitrina: VitrinaPublica } | { redirigir: true } | { sinVitrina: { nombre: string } } | null> {
  if (!/^[a-z0-9-]{2,40}$/.test(marcaSlug) || (slug && !/^[a-z0-9-]{6,80}$/.test(slug))) return null
  const db = createAdminClient()
  const { data: marca } = await db.from("cos_brands").select("id, slug, name, color").eq("slug", marcaSlug).eq("active", true).maybeSingle()
  if (!marca) return null
  const { data: vs } = await db.from("cos_vitrinas").select("id, slug, titulo, bajada, estado, created_at, approved_at").eq("brand_id", marca.id)
  const todas = (vs ?? []) as (VitrinaFila & { slug: string; titulo: string; bajada: string })[]
  let v = slug ? todas.find((x) => x.slug === slug) : vigente(todas)
  if (slug && (!v || v.estado === "retirada" || v.estado === "error" || v.estado === "armando")) {
    // Retirada o ya no está: al link fijo de la marca (si hay una vigente).
    return vigente(todas) ? { redirigir: true } : { sinVitrina: { nombre: marca.name } }
  }
  // La marca existe pero todavía no tiene ninguna vitrina armada: aviso claro en vez de 404.
  if (!v || !["lista", "aprobada"].includes(v.estado)) return { sinVitrina: { nombre: marca.name } }
  v = v!

  const [{ data: items }, { data: logo }, { data: ig }] = await Promise.all([
    db.from("cos_vitrina_items").select("*").eq("vitrina_id", v.id).order("orden"),
    db.from("cos_brand_assets").select("storage_key").eq("brand_id", marca.id).eq("kind", "logo").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("cos_social_accounts").select("display_name").eq("brand_id", marca.id).eq("platform", "instagram").limit(1).maybeSingle(),
  ])
  const st = db.storage.from("cos-media")
  const keys = [...new Set([...(items ?? []).flatMap((x) => [x.video_key, x.share_key, x.poster_key]), logo?.storage_key].filter(Boolean) as string[])]
  const { data: firmadas } = keys.length ? await st.createSignedUrls(keys, TTL) : { data: [] }
  const url = new Map((firmadas ?? []).map((f) => [f.path, f.signedUrl]))
  const descargas = await Promise.all(
    (items ?? []).map(async (x, i) =>
      x.share_key ? (await st.createSignedUrl(x.share_key, TTL, { download: `${marca.slug}-${i + 1}.${x.video_key ? "mp4" : "jpg"}` })).data?.signedUrl ?? null : null,
    ),
  )

  return {
    vitrina: {
      id: v.id,
      slug: v.slug,
      titulo: v.titulo,
      bajada: v.bajada,
      marca: { slug: marca.slug, nombre: marca.name, color: marca.color, logo: logo?.storage_key ? url.get(logo.storage_key) ?? null : null, ig: ig?.display_name ?? null },
      items: (items ?? []).map((x, i) => ({
        id: x.id,
        nombre: x.nombre,
        titulo: x.titulo,
        cuerpo: x.cuerpo,
        chip: x.chip,
        cta: x.cta,
        mensajeWa: x.mensaje_wa,
        ver: x.video_key ? url.get(x.video_key) ?? null : null,
        compartir: x.share_key ? url.get(x.share_key) ?? null : null,
        descargar: descargas[i],
        tapa: x.poster_key ? url.get(x.poster_key) ?? null : null,
        tipo: x.video_key ? "video" : "imagen",
        permalink: x.permalink,
        origenIA: !!x.origen_ia,
      })),
    },
  }
}

/** Marcas activas con su vitrina vigente (para la portada de vitrina.kitchcocenter.com). */
export async function indiceVitrinas(): Promise<{ slug: string; nombre: string; titulo: string | null; tapa: string | null }[]> {
  const db = createAdminClient()
  const { data: marcas } = await db.from("cos_brands").select("id, slug, name").eq("active", true).order("name")
  const out: { slug: string; nombre: string; titulo: string | null; tapa: string | null }[] = []
  for (const m of marcas ?? []) {
    const { data: vs } = await db.from("cos_vitrinas").select("id, slug, titulo, estado, created_at, approved_at").eq("brand_id", m.id)
    const v = vigente((vs ?? []) as (VitrinaFila & { titulo: string })[])
    let tapa: string | null = null
    if (v) {
      const { data: it } = await db.from("cos_vitrina_items").select("poster_key").eq("vitrina_id", v.id).order("orden").limit(1).maybeSingle()
      if (it?.poster_key) tapa = (await db.storage.from("cos-media").createSignedUrl(it.poster_key, TTL)).data?.signedUrl ?? null
    }
    out.push({ slug: m.slug, nombre: m.name, titulo: v?.titulo ?? null, tapa })
  }
  return out
}

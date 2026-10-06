import { requireMember } from "@/lib/cos/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrls } from "@/lib/cos/storage"
import { getActiveBrand } from "@/lib/cos/brand"
import { PageHeader } from "@/components/dashboard/page-header"
import { horarioCorto, linkWhatsapp, medidas, nombreArchivo, numeroLocal } from "../../../../shared/cos/impresion"
import { plantillasImpresion } from "../../../../shared/cos/plantillas"
import { normalizarDatos } from "../../../../shared/cos/datos-vigentes"
import { DisenoGrafico, type FormatoUI, type PiezaUI } from "./diseno-client"

export const dynamic = "force-dynamic"

/**
 * Diseño gráfico: piezas para la imprenta (imanes, envoltorios, bolsas, cintas) con las plantillas,
 * tipografías y paleta de la marca. Javier carga las medidas; sale un JPG listo para imprimir.
 */
export default async function DisenoPage() {
  await requireMember("editor")
  const brand = await getActiveBrand()
  const db = createAdminClient()
  const { data: fs } = await db.from("cos_print_formats").select("id, nombre, ancho_mm, alto_mm, sangrado_mm, dpi").order("created_at")
  const formatos: FormatoUI[] = (fs ?? []).map((f) => {
    const m = medidas({ ancho_mm: Number(f.ancho_mm), alto_mm: Number(f.alto_mm), sangrado_mm: Number(f.sangrado_mm), dpi: f.dpi })
    return { id: f.id, nombre: f.nombre, ancho_mm: Number(f.ancho_mm), alto_mm: Number(f.alto_mm), sangrado_mm: Number(f.sangrado_mm), dpi: f.dpi, px: `${m.totalAncho} × ${m.totalAlto} px` }
  })

  if (!brand) {
    return (
      <>
        <PageHeader title="Diseño gráfico" description="Piezas para la imprenta con la identidad de cada marca" />
        <div className="p-4 md:p-6">
          <p className="rounded-xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">Elegí una marca arriba a la izquierda: la pieza sale con su plantilla, sus letras y sus colores.</p>
        </div>
      </>
    )
  }

  const [{ data: b }, { data: ps }, { data: fotos }] = await Promise.all([
    db.from("cos_brands").select("plantillas, datos_vigentes").eq("id", brand.id).single(),
    db.from("cos_print_pieces").select("id, format_id, plantilla, campos, estado, archivo_key, aviso, error, created_at").eq("brand_id", brand.id).order("created_at", { ascending: false }).limit(60),
    db
      .from("cos_assets")
      .select("id, thumb_key, description, current_version_id, source, review_status")
      .eq("brand_id", brand.id)
      .eq("media_type", "photo")
      .neq("consent", "blocked")
      .not("current_version_id", "is", null)
      .not("thumb_key", "is", null)
      .order("created_at", { ascending: false })
      .limit(120),
  ])
  // Solo fotos que se pueden usar: las de la cocina o las elegidas del archivo.
  const usables = (fotos ?? []).filter((a) => ["manual", "turnos"].includes(a.source) || a.review_status === "approved").slice(0, 48)
  const porFormato = new Map(formatos.map((f) => [f.id, f]))
  const urls = await signedUrls([...usables.map((a) => a.thumb_key as string), ...((ps ?? []).map((p) => p.archivo_key).filter(Boolean) as string[])], 3 * 3600)
  // Descarga con nombre claro para la imprenta (marca-formato-medida.jpg).
  const descargas = await Promise.all(
    (ps ?? []).map(async (p) => {
      const f = porFormato.get(p.format_id)
      if (!p.archivo_key || !f) return null
      const { data } = await db.storage.from("cos-media").createSignedUrl(p.archivo_key, 3 * 3600, { download: nombreArchivo(brand.name, f) })
      return data?.signedUrl ?? null
    }),
  )
  const piezas: PiezaUI[] = (ps ?? []).map((p, i) => ({
    id: p.id,
    formato: porFormato.get(p.format_id) ?? null,
    plantilla: p.plantilla,
    campos: (p.campos ?? {}) as Record<string, string>,
    estado: p.estado as PiezaUI["estado"],
    url: p.archivo_key ? (urls[p.archivo_key] ?? null) : null,
    descarga: descargas[i],
    aviso: p.aviso,
    error: p.error,
  }))
  const datos = normalizarDatos(b?.datos_vigentes)

  return (
    <>
      <PageHeader title="Diseño gráfico" description={`${brand.name} · piezas para la imprenta: imanes, envoltorios, bolsas, cintas`} />
      <div className="p-4 md:p-6">
        <DisenoGrafico
          marca={brand.name}
          formatos={formatos}
          piezas={piezas}
          plantillas={plantillasImpresion(brand.slug, (b?.plantillas ?? []) as string[]).map((p) => ({ id: p.id, nombre: p.nombre, para: p.para, fotos: p.fotos, campos: p.campos }))}
          fotos={usables.map((a) => ({ versionId: a.current_version_id as string, thumb: urls[a.thumb_key as string] ?? null, descripcion: a.description ?? "" }))}
          sugeridos={{
            linea: datos.whatsapp ? numeroLocal(datos.whatsapp) : "",
            pie: datos.horarios ? horarioCorto(datos.horarios) : "",
            qrWhatsapp: datos.whatsapp ? linkWhatsapp(datos.whatsapp) : null,
            qrWeb: /^https?:\/\//.test(datos.web) ? datos.web : null,
          }}
        />
      </div>
    </>
  )
}

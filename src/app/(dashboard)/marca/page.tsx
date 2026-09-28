import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { createAdminClient } from "@/lib/supabase/admin"
import { PageHeader } from "@/components/dashboard/page-header"
import { BRAND_MODULES } from "../../../../shared/cos/brand-modules"
import { normalizarDatos } from "../../../../shared/cos/datos-vigentes"
import { MarcaClient, type ModuloEstado } from "./marca-client"

export const dynamic = "force-dynamic"

export default async function MarcaPage() {
  await requireMember("approver")
  const brand = await getActiveBrand()

  if (!brand) {
    return (
      <>
        <PageHeader title="Marca" description="Branding Manager: la entrevista que define cada marca" />
        <div className="p-6">
          <div className="mx-auto max-w-md rounded-xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">
            Elegí una marca en el selector (arriba a la izquierda, o arriba en el celular) para empezar su entrevista.
          </div>
        </div>
      </>
    )
  }

  const db = createAdminClient()
  const [{ data: rows, error }, { data: b }] = await Promise.all([
    db.from("cos_brand_interviews").select("module, messages, summary_md, status").eq("brand_id", brand.id),
    db.from("cos_brands").select("brandbook_md, brandbook_status, brandbook_approved_at, datos_vigentes, datos_vigentes_at").eq("id", brand.id).single(),
  ])
  if (error) throw new Error(`No se pudo cargar la entrevista: ${error.message}`)

  const modulos: ModuloEstado[] = BRAND_MODULES.map((m) => {
    const r = rows?.find((x) => x.module === m.id)
    return {
      id: m.id,
      label: m.label,
      goal: m.goal,
      status: r ? (r.status as "in_progress" | "done") : "pending",
      messages: (r?.messages as ModuloEstado["messages"]) ?? [],
      summary: r?.summary_md ?? null,
    }
  })

  return (
    <>
      <PageHeader
        title={`Marca · ${brand.name}`}
        description="Branding Manager: te entrevista como un estratega de marca y arma el brandbook que usa la IA"
      />
      <div className="p-4 md:p-6">
        <MarcaClient
          brandName={brand.name}
          color={brand.color}
          modulos={modulos}
          brandbook={b?.brandbook_md ?? null}
          brandbookStatus={(b?.brandbook_status as "none" | "draft" | "approved") ?? "none"}
          datos={normalizarDatos(b?.datos_vigentes)}
          datosAt={b?.datos_vigentes_at ?? null}
        />
      </div>
    </>
  )
}

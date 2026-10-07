import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { cargarAprobaciones } from "@/lib/cos/aprobaciones-datos"
import { PageHeader } from "@/components/dashboard/page-header"
import { ListaAprobaciones, Preparando } from "./aprobaciones-client"

export const dynamic = "force-dynamic"

export default async function AprobacionesPage() {
  await requireMember("approver")
  const brand = await getActiveBrand()
  const { pendientes, preparando, grupos: lista } = await cargarAprobaciones(brand)
  return (
    <>
      <PageHeader
        title="Aprobaciones"
        description={
          pendientes > 0
            ? `${pendientes} publicación${pendientes !== 1 ? "es" : ""} esperando tu OK${brand ? ` · ${brand.name}` : ""}`
            : "Sin publicaciones pendientes"
        }
      />
      <div className="p-4 md:p-6">
        {preparando > 0 && <Preparando cantidad={preparando} />}
        <ListaAprobaciones grupos={lista} />
      </div>
    </>
  )
}

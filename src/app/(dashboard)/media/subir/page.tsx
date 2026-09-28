import { requireMember } from "@/lib/cos/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { PageHeader } from "@/components/dashboard/page-header"
import { getActiveBrand } from "@/lib/cos/brand"
import { SubirClient } from "./subir-client"

export const dynamic = "force-dynamic"

export default async function SubirPage() {
  await requireMember("editor")
  const db = createAdminClient()
  const { data: brands } = await db.from("cos_brands").select("slug, name, color").eq("active", true).order("name")
  const active = await getActiveBrand()

  return (
    <>
      <PageHeader title="Subir contenido" description="Como lo mandaría un empleado desde la cocina" />
      <div className="p-6">
        <SubirClient brands={brands ?? []} defaultSlug={active?.slug ?? "fasutofudo"} />
      </div>
    </>
  )
}

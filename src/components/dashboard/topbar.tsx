import { PenSquare, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { UserMenu } from "./user-menu"
import { BrandSelectMobile } from "./brand-select-mobile"
import { createAdminClient } from "@/lib/supabase/admin"
import { getActiveBrand } from "@/lib/cos/brand"

export async function Topbar() {
  const [{ data: brands }, active] = await Promise.all([
    createAdminClient().from("cos_brands").select("slug, name, color").eq("active", true).order("name"),
    getActiveBrand(),
  ])
  return (
    <header className="flex h-14 items-center gap-3 border-b bg-background px-4 md:px-6 shrink-0">
      <span className="text-[17px] font-extrabold tracking-tight md:hidden" style={{ fontFamily: "var(--font-display)" }}>
        Social Hub
      </span>
      <div className="ml-auto flex items-center gap-2">
        <BrandSelectMobile brands={brands ?? []} active={active?.slug ?? null} />
        <Button asChild size="sm" variant="ghost" className="hidden font-semibold md:inline-flex">
          <Link href="/composer">
            <PenSquare className="h-4 w-4" />
            Nuevo post
          </Link>
        </Button>
        <Button asChild size="sm" className="hidden font-semibold md:inline-flex">
          <Link href="/media/subir">
            <Upload className="h-4 w-4" />
            Subir contenido
          </Link>
        </Button>
        <UserMenu />
      </div>
    </header>
  )
}

import { Sidebar } from "@/components/dashboard/sidebar"
import { Topbar } from "@/components/dashboard/topbar"
import { requireMember } from "@/lib/cos/auth"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Solo miembros de Content OS. Las acciones de servidor lo vuelven a verificar
  // cada una (el layout no protege a las Server Functions por sí solo).
  await requireMember("viewer")

  return (
    <div className="flex h-screen overflow-hidden bg-muted/30">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto pb-24 md:pb-0">
          {children}
        </main>
      </div>
    </div>
  )
}

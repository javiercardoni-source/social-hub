"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Calendar,
  PenSquare,
  Image as ImageIcon,
  BarChart3,
  Users,
  Settings,
  Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"

const navigation = [
  { name: "Composer", href: "/composer", icon: PenSquare },
  { name: "Calendario", href: "/calendar", icon: Calendar },
  { name: "Biblioteca", href: "/media", icon: ImageIcon },
  { name: "Analíticas", href: "/analytics", icon: BarChart3 },
  { name: "Cuentas", href: "/accounts", icon: Users },
  { name: "Configuración", href: "/settings", icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden md:flex w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Zap className="h-4 w-4" />
        </div>
        <span>Social Hub</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navigation.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.name}
            </Link>
          )
        })}
      </nav>

      <div className="border-t p-3">
        <div className="flex items-center gap-3 rounded-md px-3 py-2 text-xs text-sidebar-foreground/60">
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          Conectado
        </div>
      </div>
    </aside>
  )
}

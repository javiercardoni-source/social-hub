"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Images,
  CheckCircle,
  CalendarClock,
  Users,
  Settings,
  Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"

const navigation = [
  { name: "Inicio", href: "/inicio", icon: LayoutDashboard },
  { name: "Biblioteca", href: "/media", icon: Images },
  { name: "Aprobaciones", href: "/aprobaciones", icon: CheckCircle },
  { name: "Programados", href: "/calendar", icon: CalendarClock },
  { name: "Cuentas", href: "/accounts", icon: Users },
]

const bottom = [{ name: "Configuración", href: "/settings", icon: Settings }]

export function Sidebar() {
  const pathname = usePathname()

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <aside className="hidden md:flex w-60 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Zap className="h-4 w-4" />
        </div>
        <span>Content OS</span>
      </div>

      <nav className="flex-1 space-y-0.5 p-2">
        {navigation.map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(item.href)
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.name}
            </Link>
          )
        })}
      </nav>

      <div className="space-y-0.5 border-t p-2">
        {bottom.map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(item.href)
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.name}
            </Link>
          )
        })}
        <div className="flex items-center gap-3 px-3 py-2 text-xs text-sidebar-foreground/50">
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          Worker activo
        </div>
      </div>
    </aside>
  )
}

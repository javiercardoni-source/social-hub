"use client"

import { useTransition } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home,
  Images,
  CheckCircle,
  CalendarDays,
  Link2,
  Smartphone,
  Zap,
  ShieldCheck,
  PauseCircle,
  Layers,
  Loader2,
  Palette,
  BarChart3,
  LayoutGrid,
  Megaphone,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { elegirMarca } from "@/lib/cos/brand-actions"
import { cambiarPausa } from "@/lib/cos/settings-actions"
import type { Brand } from "./sidebar"

type Props = {
  brands: Brand[]
  activeSlug: string | null
  pendingCount: number
  mediaCount: number
  adsCount: number
  globalPause: boolean
  live: boolean
}

function brandInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
}

export function SidebarClient({ brands, activeSlug, pendingCount, mediaCount, adsCount, globalPause, live }: Props) {
  const pathname = usePathname()
  const [switching, startSwitch] = useTransition()
  const [pausing, startPause] = useTransition()

  const active = brands.find((b) => b.slug === activeSlug) ?? null
  const others = brands.filter((b) => b.slug !== activeSlug)

  const nav = [
    { name: "Inicio", href: "/inicio", icon: Home },
    { name: "Biblioteca", href: "/media", icon: Images, count: mediaCount > 0 ? mediaCount : null, countSoft: true },
    { name: "Aprobaciones", href: "/aprobaciones", icon: CheckCircle, count: pendingCount > 0 ? pendingCount : null },
    { name: "Calendario", href: "/calendar", icon: CalendarDays },
    { name: "Feed", href: "/feed", icon: LayoutGrid },
    { name: "Métricas", href: "/analytics", icon: BarChart3 },
    { name: "Anuncios", href: "/anuncios", icon: Megaphone, count: adsCount > 0 ? adsCount : null },
    { name: "Cuentas", href: "/accounts", icon: Link2 },
    { name: "Marca", href: "/marca", icon: Palette },
  ]

  function isActive(href: string) {
    if (href === "/media" && pathname.startsWith("/media/subir")) return false
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  const mobileNav = [
    { name: "Inicio", href: "/inicio", icon: Home },
    { name: "Biblioteca", href: "/media", icon: Images },
    { name: "Subir", href: "/media/subir", icon: Smartphone, main: true },
    { name: "Aprobar", href: "/aprobaciones", icon: CheckCircle, count: pendingCount },
    { name: "Calendario", href: "/calendar", icon: CalendarDays },
  ]

  return (
    <>
    {/* Celular: barra inferior fija (el menú lateral no entra) */}
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-end justify-around border-t bg-background/95 px-1 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5 backdrop-blur md:hidden">
      {mobileNav.map((item) => {
        const Icon = item.icon
        const on = isActive(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn("relative flex w-16 flex-col items-center gap-0.5 text-[10.5px] font-semibold", on ? "text-primary" : "text-muted-foreground")}
          >
            {item.main ? (
              <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg">
                <Icon className="h-5 w-5" />
              </span>
            ) : (
              <Icon className="h-5 w-5" />
            )}
            {item.name}
            {!!item.count && (
              <span className="absolute -top-1 right-3 min-w-[18px] rounded-full bg-primary px-1 text-center text-[10px] font-bold text-white">{item.count}</span>
            )}
          </Link>
        )
      })}
    </nav>
    <aside className="hidden md:flex w-[248px] flex-col border-r bg-sidebar text-sidebar-foreground shrink-0">
      {/* Wordmark */}
      <div className="flex items-baseline gap-2 px-[22px] pt-5 pb-4">
        <span className="text-[19px] font-extrabold leading-none tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          Social Hub
        </span>
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Content OS</span>
      </div>

      {/* Selector de marca: filtra todo el panel */}
      <div className={cn("mx-3 mb-3 rounded-[14px] border bg-muted/50 p-[10px] transition-opacity", switching && "opacity-60")}>
        <div className="flex items-center gap-[10px]">
          <div
            className="h-9 w-9 shrink-0 rounded-[10px] flex items-center justify-center text-white text-sm font-extrabold"
            style={{ backgroundColor: active?.color ?? "var(--foreground)", fontFamily: "var(--font-display)" }}
          >
            {active ? brandInitials(active.name) : <Layers className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight truncate">{active?.name ?? "Todas las marcas"}</p>
            <p className="text-xs text-muted-foreground truncate">{active ? "IG + FB" : `${brands.length} marcas`}</p>
          </div>
          {switching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="mt-[6px] flex flex-col gap-[1px] border-t border-dashed pt-[6px]">
          {active && (
            <button
              type="button"
              onClick={() => startSwitch(() => elegirMarca(""))}
              className="flex items-center gap-2 rounded-md px-1 py-[3px] text-left text-[12.5px] text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <Layers className="h-3 w-3 shrink-0" />
              Todas las marcas
            </button>
          )}
          {others.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => startSwitch(() => elegirMarca(b.slug))}
              className="flex items-center gap-2 rounded-md px-1 py-[3px] text-left text-[12.5px] text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
              <span className="truncate">{b.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-0.5 px-2">
        {nav.map((item) => {
          const Icon = item.icon
          const on = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-[10px] rounded-[10px] px-[10px] py-[9px] text-sm font-medium transition-colors",
                on ? "bg-primary/10 text-primary font-bold" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span className="flex-1">{item.name}</span>
              {item.count != null && (
                <span
                  className={cn(
                    "min-w-[22px] px-[7px] rounded-full text-xs font-bold text-center",
                    item.countSoft ? "bg-muted text-muted-foreground" : "bg-primary text-white",
                  )}
                >
                  {item.count}
                </span>
              )}
            </Link>
          )
        })}

        <div className="my-1 px-[10px]">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground/60 font-semibold">Así lo ve el empleado</p>
        </div>

        <Link
          href="/media/subir"
          className={cn(
            "flex items-center gap-[10px] rounded-[10px] px-[10px] py-[9px] text-sm font-medium transition-colors",
            isActive("/media/subir") ? "bg-primary/10 text-primary font-bold" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Smartphone className="h-[18px] w-[18px] shrink-0" />
          Enviar contenido
        </Link>
      </nav>

      {/* Seguridad */}
      <div className="flex flex-col gap-2 border-t px-4 py-4 mt-2">
        <SafeToggle icon={ShieldCheck} label="Modo seguro" sublabel="Nada sale sin tu OK (fijo)" on locked />
        <SafeToggle
          icon={PauseCircle}
          label="Pausa general"
          sublabel={globalPause ? "No sale nada hasta que la saques" : "Frena todo lo programado"}
          on={globalPause}
          busy={pausing}
          onChange={(v) => startPause(() => cambiarPausa(v))}
          danger
        />
        <div className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground/70">
          <Zap className={cn("h-3 w-3", live ? "text-emerald-500" : "text-amber-500")} />
          {live ? "Publicación real activa" : "Publicación simulada"}
        </div>
      </div>
    </aside>
    </>
  )
}

function SafeToggle({
  icon: Icon,
  label,
  sublabel,
  on,
  onChange,
  danger,
  locked,
  busy,
}: {
  icon: React.ElementType
  label: string
  sublabel: string
  on: boolean
  onChange?: (v: boolean) => void
  danger?: boolean
  locked?: boolean
  busy?: boolean
}) {
  return (
    <div className="flex items-center gap-[10px]">
      <Icon className="h-[15px] w-[15px] shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold leading-tight">{label}</p>
        <p className="text-[11.5px] text-muted-foreground leading-tight">{sublabel}</p>
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={locked || busy}
        onClick={() => onChange?.(!on)}
        className={cn(
          "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed",
          on ? (danger ? "bg-amber-500" : "bg-emerald-500") : "bg-border",
          busy && "opacity-60",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] left-0 h-4 w-4 rounded-full bg-white shadow transition-transform",
            on ? "translate-x-[19px]" : "translate-x-[3px]",
          )}
        />
      </button>
    </div>
  )
}

import Link from "next/link"
import { cn } from "@/lib/utils"

/** Métricas | Gustos (F7). */
export function MetricasTabs({ activa }: { activa: "metricas" | "gustos" }) {
  const tab = (href: string, id: typeof activa, label: string) => (
    <Link
      href={href}
      className={cn("rounded-full border px-3.5 py-1.5 text-sm font-semibold", activa === id ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
    >
      {label}
    </Link>
  )
  return (
    <div className="flex gap-2">
      {tab("/analytics", "metricas", "Métricas")}
      {tab("/analytics/gustos", "gustos", "Gustos")}
    </div>
  )
}

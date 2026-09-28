"use client"

import { useTransition } from "react"
import { elegirMarca } from "@/lib/cos/brand-actions"

type B = { slug: string; name: string; color: string }

/** Selector de marca para el celular (en la compu está en el menú lateral). */
export function BrandSelectMobile({ brands, active }: { brands: B[]; active: string | null }) {
  const [pending, start] = useTransition()
  const color = brands.find((b) => b.slug === active)?.color
  return (
    <label className="relative flex items-center gap-1.5 rounded-full border bg-background py-1 pl-2.5 pr-1 text-xs font-semibold md:hidden">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color ?? "var(--foreground)" }} />
      <select
        aria-label="Marca"
        value={active ?? ""}
        disabled={pending}
        onChange={(e) => start(() => elegirMarca(e.target.value))}
        className="max-w-[9rem] appearance-none bg-transparent pr-4 outline-none"
      >
        <option value="">Todas las marcas</option>
        {brands.map((b) => (
          <option key={b.slug} value={b.slug}>
            {b.name}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 text-[10px] text-muted-foreground">▾</span>
    </label>
  )
}

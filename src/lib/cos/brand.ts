import "server-only"
import { cache } from "react"
import { cookies } from "next/headers"
import { createAdminClient } from "@/lib/supabase/admin"

export const BRAND_COOKIE = "cos_marca"

export type ActiveBrand = { id: string; slug: string; name: string; color: string }

/** Marca elegida en el selector del menú, o null = todas las marcas. */
export const getActiveBrand = cache(async (): Promise<ActiveBrand | null> => {
  const slug = (await cookies()).get(BRAND_COOKIE)?.value
  if (!slug) return null
  const { data } = await createAdminClient()
    .from("cos_brands")
    .select("id, slug, name, color")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle()
  return data
})

"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { requireMember } from "@/lib/cos/auth"
import { BRAND_COOKIE } from "@/lib/cos/brand"

/** slug vacío = todas las marcas. */
export async function elegirMarca(slug: string) {
  await requireMember("viewer")
  const jar = await cookies()
  if (!slug) jar.delete(BRAND_COOKIE)
  else if (/^[a-z0-9-]{1,40}$/.test(slug)) {
    jar.set(BRAND_COOKIE, slug, { path: "/", httpOnly: true, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365 })
  }
  revalidatePath("/", "layout")
}

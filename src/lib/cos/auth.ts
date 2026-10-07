import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { isCosRole, roleAtLeast, type CosRole } from "./roles"

export type Member = {
  userId: string
  email: string | null
  role: CosRole
  displayName: string | null
}

/**
 * El miembro de Content OS de este request, o null si no hay sesión o el usuario no
 * está en cos_members. Cacheado por request (se puede llamar en varios lugares).
 *
 * Se consulta con el cliente del usuario: la RLS de cos_members solo deja leer a los
 * miembros, así que un usuario ajeno recibe null aunque tenga sesión en OlivosSpeed.
 */
export const getMember = cache(async (): Promise<Member | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from("cos_members")
    .select("role, display_name")
    .eq("user_id", user.id)
    .maybeSingle()
  if (error || !data || !isCosRole(data.role)) return null

  return { userId: user.id, email: user.email ?? null, role: data.role, displayName: data.display_name }
})

/**
 * Para páginas y acciones de servidor: sin sesión → /login; sin permiso → /sin-acceso.
 * La guía de datos de Next 16 pide verificar ACÁ y no confiar solo en el proxy.
 *
 * `volverA` (F12, la app de aprobación en /app): sin sesión, el login vuelve ahí en vez de a
 * /inicio (si no, el login en el celular tira a Javier al panel de escritorio).
 */
export async function requireMember(need: CosRole = "viewer", volverA?: string): Promise<Member> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(volverA ? `/login?next=${encodeURIComponent(volverA)}` : "/login")

  const member = await getMember()
  if (!member || !roleAtLeast(member.role, need)) redirect("/sin-acceso")
  return member
}

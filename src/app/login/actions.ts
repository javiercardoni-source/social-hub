"use server"

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export async function login(formData: FormData) {
  const email = formData.get("email") as string
  const password = formData.get("password") as string

  if (!email || !password) {
    return { error: "Completá email y contraseña" }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: "Email o contraseña incorrectos" }
  }

  // Volver a /app si vino de ahí (la app de aprobación en el celular, F12). Solo rutas internas.
  const next = formData.get("next") as string | null
  redirect(next && /^\/[a-zA-Z0-9/_-]*$/.test(next) ? next : "/inicio")
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}

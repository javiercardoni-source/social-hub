import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

/**
 * Rutas que se sirven SIN sesión. Todo lo demás exige estar logueado.
 *  - /login              la pantalla de entrada
 *  - /sin-acceso         a donde va quien tiene sesión pero no es miembro
 *  - /api/health         el chequeo de salud que usa el deploy
 *  - /api/webhooks/      Meta avisa comentarios y mensajes (Fase 2A). Si esto
 *                        redirigiera a /login, Meta daría de baja el webhook.
 *                        Se protege con la firma X-Hub-Signature-256, no con sesión.
 *  - /r/                 links cortos de «Comentá y te escribo» (los abre cualquiera)
 */
export const PUBLIC_PREFIXES = ["/login", "/sin-acceso", "/api/health", "/api/webhooks/", "/r/"] as const

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`))
}

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (isPublicPath(pathname)) return NextResponse.next({ request })

  // Sin configuración, se CIERRA (antes se salteaba el login y quedaba todo abierto).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return new NextResponse("Social Hub no está configurado (faltan las variables de Supabase).", {
      status: 503,
    })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
      },
    },
  })

  // IMPORTANTE: no sacar getUser(): renueva el token de la sesión.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = "/login"
    loginUrl.search = ""
    return NextResponse.redirect(loginUrl)
  }

  // Ser miembro de Content OS se verifica en cada página/acción con requireMember().
  return supabaseResponse
}

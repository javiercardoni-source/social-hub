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
 *  - /privacidad         política pública que exigen Google y Meta para sus apps
 *  - /manifest…, /icon…  para poder instalarla como app en el celular (el teléfono los pide sin sesión)
 *  - /vitrina/, /api/vitrina/  las vitrinas de anuncios (F11): web pública para compartir en Instagram
 */
export const PUBLIC_PREFIXES = [
  "/login",
  "/sin-acceso",
  "/api/health",
  "/api/webhooks/",
  "/r/",
  "/privacidad",
  "/manifest.webmanifest",
  "/icon",
  "/apple-icon",
  "/vitrina/",
  "/api/vitrina/",
] as const

/**
 * vitrina.kitchcocenter.com solo sirve vitrinas: /<marca>/… se reescribe a /vitrina/<marca>/…
 * y todo lo demás del panel da 404 en ese dominio (no se puede ni ver el login desde ahí).
 */
export function rutaVitrina(host: string, pathname: string): { rewrite: string } | { pasar: true } | { noExiste: true } | null {
  if (!host.startsWith("vitrina.")) return null
  if (pathname.startsWith("/api/vitrina/")) return { pasar: true }
  // La raíz muestra las vitrinas de todas las marcas.
  if (pathname === "/") return { rewrite: "/vitrina" }
  if (/^\/[a-z0-9-]{2,40}(\/[a-z0-9-]{6,80})?\/?$/.test(pathname)) return { rewrite: `/vitrina${pathname}` }
  return { noExiste: true }
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`))
}

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl
  const v = rutaVitrina(request.headers.get("host") ?? "", pathname)
  if (v && "noExiste" in v) return new NextResponse("No existe", { status: 404, headers: { "x-robots-tag": "noindex" } })
  if (v && "pasar" in v) return NextResponse.next({ request })
  if (v && "rewrite" in v) {
    const url = request.nextUrl.clone()
    url.pathname = v.rewrite
    return NextResponse.rewrite(url, { headers: { "x-robots-tag": "noindex, nofollow" } })
  }
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

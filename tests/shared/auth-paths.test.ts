import { describe, it, expect, vi } from "vitest"

// El módulo importa @supabase/ssr y next/server; para probar solo la lista de rutas
// públicas no hace falta nada de eso.
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }))
vi.mock("next/server", () => ({ NextResponse: {} }))

const { isPublicPath, rutaVitrina } = await import("../../src/lib/supabase/middleware")
const { roleAtLeast } = await import("../../src/lib/cos/roles")

describe("rutas públicas del proxy", () => {
  it.each(["/login", "/sin-acceso", "/api/health", "/api/webhooks/meta", "/r/FF-ONI-0929"])("%s no pide sesión", (p) => {
    expect(isPublicPath(p)).toBe(true)
  })

  it.each(["/", "/composer", "/media", "/api/webhooks", "/r", "/loginx", "/api/healthz", "/api/posts"])(
    "%s sí pide sesión",
    (p) => {
      expect(isPublicPath(p)).toBe(false)
    },
  )
})

describe("roles", () => {
  it("cada rol incluye al anterior", () => {
    expect(roleAtLeast("admin", "approver")).toBe(true)
    expect(roleAtLeast("approver", "approver")).toBe(true)
    expect(roleAtLeast("editor", "approver")).toBe(false)
    expect(roleAtLeast("viewer", "editor")).toBe(false)
  })
})

describe("vitrina.kitchcocenter.com", () => {
  it("solo sirve vitrinas; el panel no existe en ese dominio", () => {
    expect(rutaVitrina("vitrina.kitchcocenter.com", "/fasutofudo/")).toEqual({ rewrite: "/vitrina/fasutofudo/" })
    expect(rutaVitrina("vitrina.kitchcocenter.com", "/fasutofudo/onigiris-k3x9q2")).toEqual({ rewrite: "/vitrina/fasutofudo/onigiris-k3x9q2" })
    expect(rutaVitrina("vitrina.kitchcocenter.com", "/api/vitrina/evento")).toEqual({ pasar: true })
    expect(rutaVitrina("vitrina.kitchcocenter.com", "/login")).toEqual({ rewrite: "/vitrina/login" })
    expect(rutaVitrina("vitrina.kitchcocenter.com", "/inicio/x/y")).toEqual({ noExiste: true })
    expect(rutaVitrina("vitrina.kitchcocenter.com", "/")).toEqual({ rewrite: "/vitrina" })
    expect(rutaVitrina("social.kitchcocenter.com", "/inicio")).toBeNull()
  })
  it("las vitrinas son públicas en el panel también (vista previa)", () => {
    expect(isPublicPath("/vitrina/fasutofudo/")).toBe(true)
    expect(isPublicPath("/api/vitrina/evento")).toBe(true)
  })
})

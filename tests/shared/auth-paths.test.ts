import { describe, it, expect, vi } from "vitest"

// El módulo importa @supabase/ssr y next/server; para probar solo la lista de rutas
// públicas no hace falta nada de eso.
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }))
vi.mock("next/server", () => ({ NextResponse: {} }))

const { isPublicPath } = await import("../../src/lib/supabase/middleware")
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

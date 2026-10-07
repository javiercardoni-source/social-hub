import { NextResponse } from "next/server"
import { requireMember } from "@/lib/cos/auth"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Suscripción a los avisos push de la app de aprobación (F12). POST guarda la del dispositivo,
 * DELETE la borra. Solo miembros que pueden aprobar.
 */
type Sub = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }

export async function POST(req: Request) {
  const member = await requireMember("approver")
  const body = (await req.json().catch(() => null)) as Sub | null
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : ""
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : ""
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : ""
  if (!/^https:\/\/\S+$/.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) {
    return NextResponse.json({ error: "Suscripción inválida" }, { status: 400 })
  }
  const { error } = await createAdminClient()
    .from("cos_push_subs")
    .upsert({ user_id: member.userId, endpoint, p256dh, auth, user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null }, { onConflict: "endpoint" })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  await requireMember("approver")
  const body = (await req.json().catch(() => null)) as Sub | null
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : ""
  if (endpoint) await createAdminClient().from("cos_push_subs").delete().eq("endpoint", endpoint)
  return NextResponse.json({ ok: true })
}

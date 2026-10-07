/**
 * F12 · Avisos push de la app de aprobación. push:aprobar le avisa al celular de Javier que hay
 * piezas nuevas listas para aprobar: uno por tanda (≥ 30 min entre avisos) y nunca de noche
 * (de 23 a 8:30 se guarda para las 8:30). Lo piden los armados de piezas al terminar.
 */
import webpush from "web-push"
import type { Handler } from "./handlers.ts"
import type { Queue } from "./queue.ts"

const MIN = 60_000
const AR = 3 * 60 * MIN
const ENTRE_AVISOS = 30 * MIN

/** Lo piden los armados: el aviso sale 10 min después (así junta la tanda), uno por media hora. */
export async function pedirAvisoAprobar(queue: Queue) {
  const bloque = Math.floor(Date.now() / ENTRE_AVISOS)
  await queue.enqueue("push:aprobar", {}, { runAt: new Date(Date.now() + 10 * MIN), dedupeKey: `push:aprobar:${bloque}` })
}

/** 8:30 de Buenos Aires de hoy o de mañana (lo que venga primero). */
export function proximaMañana(ahora: Date): Date {
  const ba = new Date(ahora.getTime() - AR)
  const hoy = ba.toISOString().slice(0, 10)
  let t = new Date(Date.parse(`${hoy}T08:30:00Z`) + AR)
  if (t.getTime() <= ahora.getTime()) t = new Date(t.getTime() + 24 * 60 * MIN)
  return t
}

const avisarAprobar: Handler = async (_job, { db, queue, log }) => {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) {
    log("avisos push sin claves VAPID: no se manda nada")
    return
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:social@kitchco.ar", pub, priv)
  const ahora = new Date()
  const minBA = ((ahora.getTime() - AR) / MIN) % (24 * 60)
  if (minBA >= 23 * 60 || minBA < 8 * 60 + 30) {
    const t = proximaMañana(ahora)
    await queue.enqueue("push:aprobar", {}, { runAt: t, dedupeKey: `push:aprobar:mañana:${t.toISOString().slice(0, 10)}` })
    return
  }
  const { data: ultimo } = await db.from("cos_push_log").select("sent_at").order("sent_at", { ascending: false }).limit(1).maybeSingle()
  const desde = ultimo?.sent_at ? Date.parse(ultimo.sent_at) : 0
  if (desde && ahora.getTime() - desde < ENTRE_AVISOS) {
    const t = new Date(desde + ENTRE_AVISOS)
    await queue.enqueue("push:aprobar", {}, { runAt: t, dedupeKey: `push:aprobar:${Math.floor(t.getTime() / ENTRE_AVISOS)}` })
    return
  }
  // Listas = armadas y revisadas, esperando aprobación.
  const { data: listas } = await db
    .from("cos_posts")
    .select("id, first_render_at, cos_brands(name)")
    .eq("status", "PENDING_APPROVAL")
    .not("first_render_at", "is", null)
    .not("render_qa", "is", null)
  const todas = (listas ?? []) as unknown as { id: string; first_render_at: string; cos_brands: { name: string } | null }[]
  const nuevas = todas.filter((p) => Date.parse(p.first_render_at) > desde)
  if (!nuevas.length) return
  const porMarca = new Map<string, number>()
  for (const p of nuevas) porMarca.set(p.cos_brands?.name ?? "Sin marca", (porMarca.get(p.cos_brands?.name ?? "Sin marca") ?? 0) + 1)
  const aviso = {
    title: nuevas.length === 1 ? "1 pieza nueva para aprobar" : `${nuevas.length} piezas nuevas para aprobar`,
    body: [...porMarca.entries()].map(([m, n]) => `${m} ${n}`).join(" · ") + (todas.length > nuevas.length ? ` · ${todas.length} en total` : ""),
    url: "/app",
  }
  const { data: subs } = await db.from("cos_push_subs").select("id, endpoint, p256dh, auth")
  let enviados = 0
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(aviso), { TTL: 6 * 3600 })
      enviados++
      await db.from("cos_push_subs").update({ last_ok_at: new Date().toISOString() }).eq("id", s.id)
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      // 404/410: el dispositivo ya no existe (desinstaló la app o borró los datos).
      if (code === 404 || code === 410) await db.from("cos_push_subs").delete().eq("id", s.id)
      log("aviso push que no salió", { sub: s.id, code, error: String(e).slice(0, 200) })
    }
  }
  await db.from("cos_push_log").insert({ nuevas: nuevas.length, pendientes: todas.length, enviados, detalle: aviso })
  log("aviso de aprobación", { nuevas: nuevas.length, pendientes: todas.length, enviados })
}

export const pushHandlers: Record<string, Handler> = {
  "push:aprobar": avisarAprobar,
}

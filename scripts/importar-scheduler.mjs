// F10 · Motor de ADS — import de lo que juntó el Meta Ads Scheduler desde dic-2025
// (docs/PLAN-MOTOR-ADS.md, E1). Idempotente: se puede correr las veces que haga falta.
//
//   node --env-file=.env.local scripts/importar-scheduler.mjs [--dry-run]
//
// Lee por SSH (solo lectura) los JSON de kitchco-gestion:/opt/meta-ads-scheduler/logs:
//   · daily-snapshots.json  resumen diario por marca (gasto, mensajes, costo por mensaje…)
//                           → cos_ad_brand_daily
//   · capi-purchases.json   ventas que el Scheduler mandó a Meta (CAPI), por marca y día
//                           → cos_ad_brand_daily.purchases / purchase_value
//   · ads-snapshot.json     el número que el Scheduler le puso a cada anuncio («el 313»)
//                           → cos_ads.scheduler_number (solo anuncios que ya trajo ads:sync)
//
// El detalle por anuncio NO sale de acá: lo trae la API de Meta (ads:sync), que es más rico.
import { execFileSync } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import { createClient } from "@supabase/supabase-js"

const SERVIDOR = "root@187.77.225.51" // kitchco-gestion (ver infra/SERVIDORES.md)
const CARPETA = "/opt/meta-ads-scheduler/logs"
const DRY = process.argv.includes("--dry-run")

// Cómo nombra el Scheduler a cada marca → slug de Content OS (las que no están quedan sin marca).
const MARCA = { "Sensaciones (Live Javi)": "sensaciones", Bijutsukan: "bijutsukan", FasutoFudo: "fasutofudo" }
// Prefijo de las ventas CAPI → etiqueta del Scheduler.
const CAPI = { sens_pt: "Sensaciones (Live Javi)", bij: "Bijutsukan", ff: "FasutoFudo" }

function leer(archivo) {
  const out = execFileSync("ssh", ["-o", "ConnectTimeout=15", "-i", join(homedir(), ".ssh/id_ed25519"), SERVIDOR, `cat ${CARPETA}/${archivo}`], { maxBuffer: 64 * 1024 * 1024 })
  return JSON.parse(out.toString("utf8"))
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: marcas, error: eM } = await db.from("cos_brands").select("id, slug")
if (eM) throw eM
const idDe = Object.fromEntries((marcas ?? []).map((m) => [m.slug, m.id]))

// 1) Ventas CAPI por marca y día (hora de Buenos Aires).
const ventas = new Map()
for (const [clave, v] of Object.entries(leer("capi-purchases.json"))) {
  const pref = Object.keys(CAPI).find((p) => clave.startsWith(`${p}-`))
  if (!pref || !v?.sent_at) continue
  const dia = new Date(Date.parse(v.sent_at) - 3 * 3600_000).toISOString().slice(0, 10)
  const k = `${CAPI[pref]}|${dia}`
  const x = ventas.get(k) ?? { n: 0, valor: 0 }
  x.n++
  x.valor += Number(v.value) || 0
  ventas.set(k, x)
}

// 2) Resumen diario.
const diarios = leer("daily-snapshots.json")
const filas = diarios.map((d) => {
  const v = ventas.get(`${d.brand}|${d.date}`)
  const { date, brand, account_id, spend, messages, cost_per_message, first_replies, clicks, reach, impressions, ...resto } = d
  return {
    label: brand,
    date,
    ad_account_id: account_id ?? null,
    brand_id: idDe[MARCA[brand]] ?? null,
    spend: spend ?? null,
    messages: messages ?? null,
    // Lo calculó el Scheduler con los números de Meta; se guarda tal cual (no se recalcula acá).
    cost_per_message: cost_per_message ?? null,
    first_replies: first_replies ?? null,
    clicks: clicks ?? null,
    reach: reach ?? null,
    impressions: impressions ?? null,
    purchases: v?.n ?? null,
    purchase_value: v ? Math.round(v.valor * 100) / 100 : null,
    data: resto,
    imported_at: new Date().toISOString(),
  }
})
console.log(`resumen diario: ${filas.length} filas (${filas[0]?.date} → ${filas.at(-1)?.date}), ventas CAPI en ${ventas.size} marca-días`)

// 3) Número de cada anuncio.
const snap = leer("ads-snapshot.json")
const numeros = snap.filter((a) => a.id && Number.isInteger(a.ad_number)).map((a) => ({ id: String(a.id), n: a.ad_number }))
console.log(`números de anuncio: ${numeros.length}`)

if (DRY) {
  console.log("(--dry-run: no se escribió nada)")
  process.exit(0)
}
for (let i = 0; i < filas.length; i += 500) {
  const { error } = await db.from("cos_ad_brand_daily").upsert(filas.slice(i, i + 500), { onConflict: "label,date" })
  if (error) throw error
}
let puestos = 0
for (const { id, n } of numeros) {
  const { data, error } = await db.from("cos_ads").update({ scheduler_number: n }).eq("id", id).select("id")
  if (error) throw error
  puestos += data?.length ?? 0
}
console.log(`✓ importado. Números puestos en ${puestos} anuncios (los demás todavía no los trajo ads:sync).`)

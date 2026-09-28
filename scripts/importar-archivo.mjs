// F2 — Importa una carpeta del Mac al Archivo de Content OS (Biblioteca → Archivo).
//
//   node --env-file=.env.local scripts/importar-archivo.mjs <carpeta> <marca>
//   ej: node --env-file=.env.local scripts/importar-archivo.mjs "~/Documents/Sistema Kitchco/ADS Fasutofudo" fasutofudo
//
// · Sube cada foto/video a cos-media y crea el asset como "archivo" (pendiente de revisar).
// · La IA lo analiza de a poco: los trabajos se reparten en el tiempo (no frenan publicaciones).
// · Reanudable e idempotente: lo ya importado se saltea (clave = ruta relativa + tamaño).
import { readdirSync, readFileSync, statSync } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { basename, extname, join, relative } from "node:path"
import { createClient } from "@supabase/supabase-js"

const [dirArg, slug] = process.argv.slice(2)
if (!dirArg || !slug) {
  console.error('Uso: node --env-file=.env.local scripts/importar-archivo.mjs "<carpeta>" <marca>')
  process.exit(1)
}
const root = dirArg.replace(/^~/, homedir())
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime" }
const SPACING_S = 25 // un análisis cada 25 s: ~140 por hora
const MAX_BYTES = 500 * 1024 * 1024 // límite del bucket cos-media

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: brand } = await db.from("cos_brands").select("id, slug").eq("slug", slug).eq("active", true).single()
if (!brand) throw new Error(`marca desconocida: ${slug}`)

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}

// El próximo análisis arranca después del último ya programado (así varias corridas no se pisan).
const { data: last } = await db.from("cos_jobs").select("run_at").eq("type", "asset:process").eq("status", "queued").order("run_at", { ascending: false }).limit(1)
let next = Math.max(Date.now(), last?.[0] ? new Date(last[0].run_at).getTime() : 0)

let nuevos = 0
let salteados = 0
let ignorados = 0
for (const file of walk(root)) {
  const ext = extname(file).toLowerCase()
  const mime = MIME[ext]
  if (!mime) {
    ignorados++
    continue
  }
  const rel = relative(root, file)
  const size = statSync(file).size
  if (size > MAX_BYTES) {
    console.log(`✗ ${rel}: pesa ${Math.round(size / 1048576)} MB, el máximo es 500 MB (salteado)`)
    ignorados++
    continue
  }
  const externalId = `archivo:${createHash("sha1").update(`${basename(root)}/${rel}|${size}`).digest("hex")}`
  const { data: ya } = await db.from("cos_assets").select("id").eq("source", "archivo").eq("source_external_id", externalId).maybeSingle()
  if (ya) {
    salteados++
    continue
  }
  const key = `originals/${brand.slug}/archivo/${randomUUID()}${ext}`
  const up = await db.storage.from("cos-media").upload(key, readFileSync(file), { contentType: mime })
  if (up.error) {
    console.log(`✗ ${rel}: ${up.error.message}`)
    continue
  }
  const { data: asset, error } = await db
    .from("cos_assets")
    .insert({
      brand_id: brand.id,
      source: "archivo",
      source_external_id: externalId,
      // Provisoria: la IA la reemplaza con lo que ve.
      description: `Material de archivo: ${basename(root)}/${rel}`.slice(0, 300),
      description_by_ai: true,
      submitted_by_label: "Archivo",
      mime,
      size_bytes: size,
      storage_driver: "supabase",
      storage_key: key,
      status: "NEW",
      review_status: "pending",
      origin_path: `${basename(root)}/${rel}`,
    })
    .select("id")
    .single()
  if (error) {
    console.log(`✗ ${rel}: ${error.message}`)
    continue
  }
  next += SPACING_S * 1000
  const j = await db.rpc("cos_enqueue_job", {
    p_type: "asset:process",
    p_payload: { asset_id: asset.id },
    p_run_at: new Date(next).toISOString(),
    p_dedupe_key: `process:${asset.id}`,
  })
  if (j.error) console.log(`✗ cola ${rel}: ${j.error.message}`)
  nuevos++
  if (nuevos % 20 === 0) console.log(`  … ${nuevos} importados`)
}
console.log(`✓ ${brand.slug}: ${nuevos} nuevos, ${salteados} ya estaban, ${ignorados} ignorados (formato no soportado)`)
console.log(`  La IA termina de analizarlos cerca de las ${new Date(next).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" })}.`)

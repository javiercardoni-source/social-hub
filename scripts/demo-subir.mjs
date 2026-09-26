// Sube material de prueba al circuito de Content OS, como si lo hubiera mandado alguien
// desde la carga manual: archivo al bucket cos-media + asset NEW + trabajo asset:process.
// Después el worker hace el resto (ffprobe, miniatura, versión, clasificación con IA).
//
// Uso:
//   node --env-file=.env.local scripts/demo-subir.mjs <marca> <archivo> "<descripción>"
//   ej: node --env-file=.env.local scripts/demo-subir.mjs fasutofudo ./foto.jpg "Caja con 3 onigiris recién armados"
//
// Todo lo que sube queda marcado como «Prueba» (submitted_by_label) para distinguirlo.
import { readFileSync } from "node:fs"
import { basename, extname } from "node:path"
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

const [slug, file, description] = process.argv.slice(2)
if (!slug || !file || !description) {
  console.error('Uso: node --env-file=.env.local scripts/demo-subir.mjs <marca> <archivo> "<descripción>"')
  process.exit(1)
}

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime" }
const ext = extname(file).toLowerCase()
const mime = MIME[ext]
if (!mime) throw new Error(`formato no soportado: ${ext}`)

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const { data: brand, error: be } = await db.from("cos_brands").select("id, slug").eq("slug", slug).single()
if (be) throw new Error(`marca ${slug}: ${be.message}`)

const month = new Date().toISOString().slice(0, 7)
const key = `originals/${brand.slug}/${month}/${randomUUID()}${ext}`
const data = readFileSync(file)
const up = await db.storage.from("cos-media").upload(key, data, { contentType: mime })
if (up.error) throw new Error(`subida: ${up.error.message}`)

const { data: asset, error: ae } = await db
  .from("cos_assets")
  .insert({
    brand_id: brand.id,
    source: "manual",
    source_external_id: `demo:${randomUUID()}`,
    description,
    submitted_by_label: "Prueba (carga manual)",
    kitchen_label: null,
    mime,
    size_bytes: data.byteLength,
    storage_driver: "supabase",
    storage_key: key,
    status: "NEW",
  })
  .select("id")
  .single()
if (ae) throw new Error(`asset: ${ae.message}`)

const { error: je } = await db.rpc("cos_enqueue_job", {
  p_type: "asset:process",
  p_payload: { asset_id: asset.id },
  p_dedupe_key: `process:${asset.id}`,
})
if (je) throw new Error(`cola: ${je.message}`)

console.log(`✓ ${basename(file)} → asset ${asset.id} (${brand.slug}), encolado para procesar`)

// Sube la música de cada marca a su biblioteca (cos-media/music/<marca>/).
// Carpeta de origen: ~/Documents/Sistema Kitchco/Content OS musica/<marca>/ (mp3, m4a, wav).
// Idempotente: lo que ya está subido se saltea. Se corre de nuevo cada vez que agregues temas.
//
//   node --env-file=.env.local scripts/musica-subir.mjs
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, extname } from "node:path"
import { createClient } from "@supabase/supabase-js"

const ROOT = join(homedir(), "Documents/Sistema Kitchco/Content OS musica")
const MIME = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".aac": "audio/aac" }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Nombre prolijo para la biblioteca: sin tildes, espacios ni símbolos raros.
const clean = (name) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/-+/g, "-").replace(/^-|-(?=\.)/g, "")

const { data: brands } = await db.from("cos_brands").select("slug").eq("active", true)
let subidos = 0
for (const { slug } of brands ?? []) {
  const dir = join(ROOT, slug)
  if (!existsSync(dir)) continue
  const { data: ya } = await db.storage.from("cos-media").list(`music/${slug}`, { limit: 100 })
  const existentes = new Set((ya ?? []).map((f) => f.name))
  for (const f of readdirSync(dir)) {
    const ext = extname(f).toLowerCase()
    if (!MIME[ext]) continue
    const name = clean(f)
    if (existentes.has(name)) continue
    const { error } = await db.storage.from("cos-media").upload(`music/${slug}/${name}`, readFileSync(join(dir, f)), { contentType: MIME[ext] })
    console.log(error ? `✗ ${slug}/${f}: ${error.message}` : `✓ ${slug}/${name}`)
    if (!error) subidos++
  }
  const { data: total } = await db.storage.from("cos-media").list(`music/${slug}`, { limit: 100 })
  console.log(`  ${slug}: ${total?.length ?? 0} temas en la biblioteca`)
}
console.log(subidos ? `\nListo: ${subidos} temas nuevos.` : "\nNo había temas nuevos.")

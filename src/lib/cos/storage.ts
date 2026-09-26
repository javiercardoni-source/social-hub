import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

const BUCKET = "cos-media"

/** URL firmada para un solo archivo del bucket cos-media (privado). */
export async function signedUrl(key: string | null | undefined, expiresIn = 3600): Promise<string | null> {
  if (!key) return null
  const db = createAdminClient()
  const { data } = await db.storage.from(BUCKET).createSignedUrl(key, expiresIn)
  return data?.signedUrl ?? null
}

/** URLs firmadas para varios archivos de una vez. Devuelve { key → url }. */
export async function signedUrls(keys: string[], expiresIn = 3600): Promise<Record<string, string>> {
  const unique = [...new Set(keys.filter(Boolean))]
  if (unique.length === 0) return {}
  const db = createAdminClient()
  const { data } = await db.storage.from(BUCKET).createSignedUrls(unique, expiresIn)
  const result: Record<string, string> = {}
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) result[item.path] = item.signedUrl
  }
  return result
}

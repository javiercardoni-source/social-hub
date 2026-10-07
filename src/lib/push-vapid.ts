/**
 * F12 · Conversión de la clave pública VAPID (base64url, como la da web-push) al Uint8Array que
 * pide `PushManager.subscribe({ applicationServerKey })`. Aparte para poder testearla sin DOM.
 */
export function claveVapid(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4)
  const base64url = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64url)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

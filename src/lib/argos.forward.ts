// ─────────────────────────────────────────────────────────────────────────────
// Reenvío a ARGOS CENTRAL. Copiar a: src/lib/argos.forward.ts
//
// Además de guardar el reporte en la Supabase del proyecto, lo manda al panel
// unificado (argos.kitchcocenter.com/errores), donde Javier ve los errores de
// TODAS las plataformas juntos y abre la carpeta del proyecto en VS Code de un clic.
//
// Se prende con dos env vars. SIN ellas esto no hace absolutamente nada, así que
// se puede deployar en cualquier proyecto sin cambiar su comportamiento:
//
//   ARGOS_CENTRAL_URL=https://argos.kitchcocenter.com
//   ARGOS_CENTRAL_TOKEN=<el ingest_token del proyecto en argos_projects>
//
// El token sale de correr `sql/argos_central.sql` en la Supabase de OlivosSpeed
// (el SELECT final los imprime).
// ─────────────────────────────────────────────────────────────────────────────

export interface CentralPayload {
  /** id del reporte en la tabla local — evita duplicados si se reintenta */
  reportId?: string;
  /** ISO. Cuándo lo reportó el usuario (el central guarda aparte cuándo llegó) */
  createdAt?: string;
  note: string;
  /** data URL de la captura, tal cual la manda el navegador */
  screenshot?: unknown;
  /** data URLs de las fotos adjuntas (hasta 5) */
  attachments?: unknown[];
  pageUrl?: unknown;
  userAgent?: unknown;
  /** quién reportó: id de usuario, mail, o "anonimo" */
  reporter?: string | null;
}

const TIMEOUT_MS = 20_000;

export function isCentralEnabled(): boolean {
  return Boolean(process.env.ARGOS_CENTRAL_URL && process.env.ARGOS_CENTRAL_TOKEN);
}

/**
 * Dispara el reenvío. Devuelve la promesa (o null si el central no está
 * configurado) que resuelve en **true si el central lo aceptó**.
 *
 * Conviene llamarlo ANTES de las subidas locales y hacerle `await` al final del
 * handler: así viaja en paralelo y casi no suma espera, pero tampoco lo corta el
 * cierre de la request. Nunca tira: si el central está caído solo avisa por consola
 * y el reporte local queda guardado igual.
 *
 * El booleano importa para los proyectos **sin Supabase propia** (modo
 * central-only, como el market): ahí el central es el único destino, así que si
 * falla hay que avisarle al usuario en vez de decirle que se guardó.
 */
export function forwardToCentral(payload: CentralPayload): Promise<boolean> | null {
  const base = process.env.ARGOS_CENTRAL_URL;
  const token = process.env.ARGOS_CENTRAL_TOKEN;
  if (!base || !token) return null;

  return fetch(`${base.replace(/\/+$/, "")}/api/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
    .then(async (res) => {
      if (res.ok) return true;
      console.warn("[Argos] el central respondió", res.status, await res.text().catch(() => ""));
      return false;
    })
    .catch((e) => {
      console.warn("[Argos] no se pudo reenviar al central:", (e as Error).message);
      return false;
    });
}

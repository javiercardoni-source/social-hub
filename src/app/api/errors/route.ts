import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  getServiceClient, requireUser, requireAdminUser,
  BUCKET, TABLE, PROJECT_NAME,
} from "@/lib/argos.config";
import { forwardToCentral } from "@/lib/argos.forward";

// ─────────────────────────────────────────────────────────────────────────────
// API del reporte de errores. Copiar a: src/app/api/errors/route.ts
// POST  → cualquier usuario autenticado envía un reporte (captura + nota + hasta 5 fotos)
// GET   → solo admin lista los reportes (con URLs firmadas)
// PATCH → solo admin marca resuelto / reabre
// Las capturas y fotos viven en un bucket PRIVADO (pueden contener datos sensibles).
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 9 * 1024 * 1024;

// Columnas del select. attachment_paths es reciente: si el proyecto todavía no
// corrió la migración, caemos a LEGACY_COLS en vez de romper.
const COLS = "id, project, note, screenshot_path, attachment_paths, page_url, user_agent, status, created_at, resolved_at, reporter_id";
const LEGACY_COLS = COLS.replace(", attachment_paths", "");
const missingAttachmentsColumn = (msg?: string) => !!msg && msg.includes("attachment_paths");

// El bucket privado se auto-crea en el primer uso (no requiere paso manual).
let bucketEnsured = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureBucket(service: any) {
  if (bucketEnsured) return;
  try { await service.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 10 * 1024 * 1024 }); } catch { /* ya existe */ }
  bucketEnsured = true;
}

// Sube un data URL al bucket privado y devuelve el path guardado (o null si no va).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uploadDataUrl(service: any, dataUrl: unknown): Promise<string | null> {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return null;
  try {
    const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return null;
    const mime = match[1];
    const ext = mime.split("/")[1] === "png" ? "png" : mime.split("/")[1] === "webp" ? "webp" : "jpg";
    const buffer = Buffer.from(match[2], "base64");
    // [FIX-2026-08-20] Antes esto era un `return null` mudo: si la captura pasaba
    // el límite, el reporte se guardaba sin imagen y nadie se enteraba de por qué.
    if (buffer.byteLength > MAX_FILE_BYTES) {
      console.error(`[Errors] imagen descartada: ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB > ${MAX_FILE_BYTES / 1024 / 1024} MB`);
      return null;
    }

    await ensureBucket(service);
    const path = `${PROJECT_NAME}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const { error } = await service.storage.from(BUCKET).upload(path, buffer, { contentType: mime, upsert: false });
    if (error) { console.error("[Errors] upload:", error.message); return null; }
    return path;
  } catch (e) {
    console.error("[Errors] decode imagen:", e);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const { note, screenshot, attachments, pageUrl, userAgent } = await request.json();
  if (!note || !note.trim()) {
    return NextResponse.json({ error: "La nota es requerida" }, { status: 400 });
  }

  // El id lo generamos acá (en vez de dejárselo al DEFAULT de la tabla) para que
  // el central pueda guardarlo como origin_report_id sin esperar al insert local.
  const reportId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const forwarding = forwardToCentral({
    reportId,
    createdAt,
    note: note.trim().slice(0, 2000),
    screenshot,
    attachments: Array.isArray(attachments) ? attachments.slice(0, MAX_ATTACHMENTS) : [],
    pageUrl,
    userAgent,
    reporter: (user as { id: string }).id,
  });

  // Guardado local. Va en try/catch a propósito: hay proyectos SIN Supabase propia
  // (modo central-only, como el market de Poletti) donde getServiceClient() tira.
  // Ahí el central es el único destino y el reporte tiene que salir igual.
  let guardadoLocal = false;
  try {
    const service = getServiceClient();
    const screenshotPath = await uploadDataUrl(service, screenshot);

    // Fotos que el usuario adjuntó de su galería (ya vienen comprimidas del cliente).
    const attachmentPaths: string[] = [];
    if (Array.isArray(attachments)) {
      for (const item of attachments.slice(0, MAX_ATTACHMENTS)) {
        const path = await uploadDataUrl(service, item);
        if (path) attachmentPaths.push(path);
      }
    }

    const row = {
      id: reportId,
      created_at: createdAt,
      project: PROJECT_NAME,
      reporter_id: (user as { id: string }).id,
      note: note.trim().slice(0, 2000),
      screenshot_path: screenshotPath,
      attachment_paths: attachmentPaths.length ? attachmentPaths : null,
      page_url: typeof pageUrl === "string" ? pageUrl.slice(0, 500) : null,
      user_agent: typeof userAgent === "string" ? userAgent.slice(0, 500) : null,
    };

    let { error } = await service.from(TABLE).insert(row);
    if (error && missingAttachmentsColumn(error.message)) {
      console.warn("[Errors] falta la columna attachment_paths — corré la migración de sql/error_reports.sql");
      const { attachment_paths: _omit, ...legacy } = row;
      ({ error } = await service.from(TABLE).insert(legacy));
    }
    if (error) console.error("[Errors] insert local:", error.message);
    guardadoLocal = !error;
  } catch (e) {
    console.warn("[Errors] sin guardado local:", (e as Error).message);
  }

  // El reenvío ya venía corriendo en paralelo: lo esperamos recién acá para que
  // no lo corte el cierre de la request (nunca tira, se traga sus propios errores).
  const guardadoCentral = forwarding ? await forwarding : false;

  // Solo es un error si NO quedó en ningún lado. Con que uno de los dos haya
  // funcionado, el reporte existe y el usuario no tiene por qué reescribirlo.
  if (!guardadoLocal && !guardadoCentral) {
    return NextResponse.json({ error: "No se pudo guardar el reporte" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// Con el select en variable (para el fallback), Supabase no puede inferir la fila:
// tipamos el resultado a mano.
type ReportRow = Record<string, unknown>;
type QueryResult = { data: ReportRow[] | null; error: { message: string } | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchReports(service: any, cols: string): Promise<QueryResult> {
  const { data, error } = await service
    .from(TABLE)
    .select(cols)
    .order("created_at", { ascending: false })
    .limit(200);
  return { data: (data as ReportRow[] | null) ?? null, error: error ?? null };
}

export async function GET() {
  const admin = await requireAdminUser();
  if (admin instanceof NextResponse) return admin;

  const service = getServiceClient();

  let { data, error } = await fetchReports(service, COLS);
  if (error && missingAttachmentsColumn(error.message)) {
    console.warn("[Errors] falta la columna attachment_paths — corré la migración de sql/error_reports.sql");
    ({ data, error } = await fetchReports(service, LEGACY_COLS));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sign = async (path: string) => {
    const { data: signed } = await service.storage.from(BUCKET).createSignedUrl(path, 3600);
    return signed?.signedUrl || null;
  };

  const reports = await Promise.all(
    (data || []).map(async (r: ReportRow) => {
      const screenshotUrl = r.screenshot_path ? await sign(r.screenshot_path as string) : null;
      const paths = Array.isArray(r.attachment_paths) ? (r.attachment_paths as string[]) : [];
      const attachmentUrls = (await Promise.all(paths.map(sign))).filter(Boolean) as string[];
      return { ...r, screenshotUrl, attachmentUrls };
    })
  );

  return NextResponse.json({ reports });
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdminUser();
  if (admin instanceof NextResponse) return admin;

  const { id, status } = await request.json();
  if (!id || (status !== "open" && status !== "resolved")) {
    return NextResponse.json({ error: "id y status válidos requeridos" }, { status: 400 });
  }

  const service = getServiceClient();
  const { error } = await service.from(TABLE)
    .update({ status, resolved_at: status === "resolved" ? new Date().toISOString() : null })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

"use client";

import { useState, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";

// ─────────────────────────────────────────────────────────────────────────────
// Botón flotante de reporte de errores (🐛) — visible en todas las pantallas.
// Al apretarlo captura la pantalla (via argos.capture.ts, que aplana el scroll de
// los contenedores antes de serializar), pide una nota y la envía a /api/errors.
// En el modal también se pueden adjuntar hasta 5 fotos de la galería (se
// redimensionan y comprimen en el navegador antes de subirse).
// Autocontenido: no depende de ninguna librería del proyecto (ni sonner). Copiar a
// src/components/error-report-button.tsx y montar en el layout raíz.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ATTACHMENTS = 5;
const MAX_SIDE = 1400; // lado más largo después de redimensionar
const TARGET_BYTES = 500 * 1024; // apuntamos a ~500 KB por foto

// Las fotos de celular pesan 3-8 MB cada una: sin esto, 5 adjuntos son ~40 MB
// de base64 y el POST no llega. Redimensiona + baja calidad hasta el target.
async function compressImage(file: File): Promise<string> {
  let source: ImageBitmap | HTMLImageElement | null = null;
  let objectUrl: string | null = null;

  try {
    if (typeof createImageBitmap === "function") {
      // imageOrientation respeta el EXIF (fotos sacadas de costado con el celu).
      try { source = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { source = null; }
    }
    if (!source) {
      objectUrl = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((ok, fail) => {
        img.onload = () => ok();
        img.onerror = () => fail(new Error("formato de imagen no soportado"));
        img.src = objectUrl as string;
      });
      source = img;
    }

    const sw = (source as HTMLImageElement).naturalWidth || source.width;
    const sh = (source as HTMLImageElement).naturalHeight || source.height;
    if (!sw || !sh) throw new Error("imagen vacía");

    const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas no disponible");
    ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);

    let quality = 0.72;
    let out = canvas.toDataURL("image/jpeg", quality);
    while (out.length * 0.75 > TARGET_BYTES && quality > 0.4) {
      quality -= 0.12;
      out = canvas.toDataURL("image/jpeg", quality);
    }
    return out;
  } finally {
    if (source && "close" in source) (source as ImageBitmap).close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export function ErrorReportButton() {
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [capturing, setCapturing] = useState(false);
  const [open, setOpen] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const reset = useCallback(() => {
    setScreenshot(null);
    setAttachments([]);
    setNote("");
    setStatus(null);
  }, []);

  const capture = useCallback(async () => {
    if (capturing) return;
    setCapturing(true);
    setStatus(null);
    try {
      // La captura vive en argos.capture.ts: aplana el scroll de los contenedores
      // antes de serializar. Sin eso, cualquier lista scrolleada (y sobre todo las
      // virtualizadas) sale vacía — ver el comentario largo de ese archivo.
      const { captureViewport } = await import("@/lib/argos.capture");
      const { dataUrl, warnings } = await captureViewport();
      if (warnings.length) console.warn("[ErrorReport] captura:", warnings.join(" · "));
      if (!dataUrl) setStatus("No se pudo capturar la pantalla — describí el problema igual.");
      setScreenshot(dataUrl);
      setAttachments([]);
      setNote("");
      setOpen(true);
    } finally {
      setCapturing(false);
    }
  }, [capturing]);

  const onPickFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // permite volver a elegir la misma foto
    if (files.length === 0) return;

    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) { setStatus(`Máximo ${MAX_ATTACHMENTS} fotos`); return; }

    const picked = files.filter((f) => f.type.startsWith("image/")).slice(0, room);
    setStatus(files.length > room ? `Entran hasta ${MAX_ATTACHMENTS} fotos — agregué las primeras ${room}` : null);
    setAttaching(true);
    try {
      const done: string[] = [];
      for (const file of picked) {
        try { done.push(await compressImage(file)); }
        catch (err) {
          console.error("[ErrorReport] no pude procesar", file.name, err);
          setStatus(`No pude leer "${file.name}"`);
        }
      }
      if (done.length) setAttachments((prev) => [...prev, ...done].slice(0, MAX_ATTACHMENTS));
    } finally {
      setAttaching(false);
    }
  }, [attachments.length]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setStatus(null);
  }, []);

  const submit = useCallback(async () => {
    if (!note.trim()) { setStatus("Escribí qué pasó"); return; }
    setSending(true);
    setStatus(null);
    try {
      const res = await fetch("/api/errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: note.trim(),
          screenshot,
          attachments,
          pageUrl: window.location.href,
          userAgent: navigator.userAgent,
        }),
      });
      if (res.ok) {
        setOpen(false);
        reset();
      } else {
        const e = await res.json().catch(() => ({}));
        setStatus(e.error || "No se pudo enviar el reporte");
      }
    } catch {
      setStatus("Sin conexión — reporte no enviado");
    } finally {
      setSending(false);
    }
  }, [note, screenshot, attachments, reset]);

  // F12: /app es la app de aprobación a pantalla completa (sin esto ni nada más encima); el
  // botón, además, queda justo donde se desliza para aprobar/rechazar.
  if (pathname === "/login" || pathname.startsWith("/app")) return null;

  const busy = sending || attaching;

  return (
    <div data-error-report-ignore="true">
      {!open && (
        <button
          onClick={capture}
          disabled={capturing}
          title="Reportar un error / algo raro"
          className="argos-fab"
          style={{
            position: "fixed", bottom: 16, right: 16, zIndex: 2147483000,
            width: 48, height: 48, borderRadius: "9999px", border: "none",
            background: "#ef4444", color: "#fff", cursor: "pointer",
            boxShadow: "0 4px 14px rgba(0,0,0,0.25)", fontSize: 20,
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: capturing ? 0.7 : 1,
          }}
        >
          {capturing ? "…" : "🐛"}
        </button>
      )}

      {open && (
        <div
          onClick={() => !busy && setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 2147483000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--card, #fff)", color: "var(--foreground, #111)", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", width: "100%", maxWidth: 420, padding: 20, maxHeight: "90vh", overflowY: "auto" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 18, marginBottom: 12 }}>
              <span>🐛</span> Reportar un error
            </div>

            {screenshot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={screenshot} alt="Captura" style={{ width: "100%", maxHeight: 200, objectFit: "contain", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, marginBottom: 12 }} />
            ) : (
              <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>Sin captura (falló). Podés describir el problema igual.</p>
            )}

            <label style={{ fontSize: 14, fontWeight: 500 }}>¿Qué pasó?</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              autoFocus
              rows={3}
              placeholder="Describí el problema…"
              style={{ marginTop: 4, width: "100%", boxSizing: "border-box", borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", padding: "8px 12px", fontSize: 14, resize: "none", background: "var(--background, #fff)", color: "inherit" }}
            />

            {/* ── Fotos de la galería (hasta 5) ── */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onPickFiles}
              style={{ display: "none" }}
            />

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy || attachments.length >= MAX_ATTACHMENTS}
                style={{
                  fontSize: 13, padding: "8px 12px", borderRadius: 8,
                  border: "1px dashed rgba(0,0,0,0.25)", background: "transparent",
                  color: "inherit", cursor: busy || attachments.length >= MAX_ATTACHMENTS ? "not-allowed" : "pointer",
                  opacity: busy || attachments.length >= MAX_ATTACHMENTS ? 0.5 : 1,
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                📎 {attaching ? "Procesando…" : "Adjuntar fotos"}
              </button>
              <span style={{ fontSize: 12, opacity: 0.6 }}>{attachments.length}/{MAX_ATTACHMENTS}</span>
            </div>

            {attachments.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {attachments.map((src, i) => (
                  <div key={i} style={{ position: "relative", width: 60, height: 60 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Foto ${i + 1}`} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)" }} />
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      disabled={sending}
                      title="Quitar foto"
                      aria-label={`Quitar foto ${i + 1}`}
                      style={{
                        position: "absolute", top: -6, right: -6, width: 20, height: 20,
                        borderRadius: "9999px", border: "none", background: "#ef4444", color: "#fff",
                        fontSize: 12, lineHeight: 1, cursor: "pointer", padding: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {status && <p style={{ color: "#ef4444", fontSize: 13, marginTop: 8 }}>{status}</p>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setOpen(false)} disabled={busy} style={{ fontSize: 14, padding: "8px 16px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "inherit" }}>Cancelar</button>
              <button onClick={submit} disabled={busy || !note.trim()} style={{ fontSize: 14, padding: "8px 16px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", cursor: "pointer", opacity: busy || !note.trim() ? 0.5 : 1 }}>
                {sending ? "Enviando…" : "Enviar reporte"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

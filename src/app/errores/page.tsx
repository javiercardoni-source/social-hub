"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { isBrowserUserAdmin } from "@/lib/argos.client";

// Página admin de errores. Copiar a: src/app/errores/page.tsx
// Muestra los reportes con captura + fotos adjuntas + nota + estado, filtrable,
// con Resolver/Reabrir y un visor con flechas para pasar entre las imágenes.

interface ErrorReport {
  id: string;
  project: string | null;
  note: string;
  screenshot_path: string | null;
  screenshotUrl: string | null;
  attachmentUrls?: string[] | null;
  page_url: string | null;
  status: "open" | "resolved";
  created_at: string;
}

export default function ErroresPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<ErrorReport[]>([]);
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/errors");
    if (res.ok) { const { reports } = await res.json(); setReports(reports || []); }
    else if (res.status === 403) window.location.href = "/";
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const ok = await isBrowserUserAdmin();
      if (!ok) return;
      setIsAdmin(true);
      await load();
    })();
  }, [load]);

  // Flechas y Escape en el visor de imágenes.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight") setLightbox((l) => l && { ...l, index: (l.index + 1) % l.urls.length });
      if (e.key === "ArrowLeft") setLightbox((l) => l && { ...l, index: (l.index - 1 + l.urls.length) % l.urls.length });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const setStatus = async (id: string, status: "open" | "resolved") => {
    setReports((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
    const res = await fetch("/api/errors", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    if (!res.ok) load();
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const shortPage = (url: string | null) => { if (!url) return ""; try { return new URL(url).pathname; } catch { return url; } };
  // Todas las imágenes del reporte en un solo carrete: captura primero, fotos después.
  const gallery = (r: ErrorReport) => [r.screenshotUrl, ...(r.attachmentUrls || [])].filter(Boolean) as string[];

  if (loading) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 14 }}>Cargando reportes…</div>;
  if (!isAdmin) return null;

  const filtered = reports.filter((r) => filter === "all" ? true : r.status === filter);
  const openCount = reports.filter((r) => r.status === "open").length;

  return (
    <div style={{ minHeight: "100vh", background: "var(--background, #fff)", color: "var(--foreground, #111)" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>👁️ Argos — errores reportados</h1>
            <p style={{ fontSize: 14, opacity: 0.7, marginTop: 4 }}>{openCount > 0 ? `${openCount} sin resolver` : "Todo resuelto 🎉"}</p>
          </div>
          <Link href="/" style={{ fontSize: 14, opacity: 0.7, textDecoration: "none", color: "inherit" }}>← Volver</Link>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["open", "resolved", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={{ fontSize: 14, padding: "6px 12px", borderRadius: 8, border: "1px solid", borderColor: filter === f ? "#3b82f6" : "rgba(0,0,0,0.15)", background: filter === f ? "rgba(59,130,246,0.1)" : "transparent", color: "inherit", cursor: "pointer" }}>
              {f === "open" ? "Sin resolver" : f === "resolved" ? "Resueltos" : "Todos"}
            </button>
          ))}
          <button onClick={load} style={{ fontSize: 14, padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", background: "transparent", color: "inherit", cursor: "pointer", marginLeft: "auto" }}>↻ Actualizar</button>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", color: "#888", fontSize: 14, padding: "64px 0" }}>No hay reportes.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filtered.map((r) => {
              const photos = r.attachmentUrls || [];
              const urls = gallery(r);
              return (
                <div key={r.id} style={{ borderRadius: 12, border: "1px solid", borderColor: r.status === "resolved" ? "rgba(0,0,0,0.1)" : "rgba(239,68,68,0.3)", background: r.status === "resolved" ? "rgba(0,0,0,0.02)" : "rgba(239,68,68,0.04)", padding: 16, display: "flex", gap: 16, opacity: r.status === "resolved" ? 0.7 : 1 }}>
                  {r.screenshotUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.screenshotUrl} alt="Captura" onClick={() => setLightbox({ urls, index: 0 })} style={{ width: 128, height: 96, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)", cursor: "zoom-in", flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 128, height: 96, borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)", background: "rgba(0,0,0,0.03)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#888", flexShrink: 0 }}>sin captura</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.note}</p>

                    {photos.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {photos.map((url, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={url}
                            src={url}
                            alt={`Foto ${i + 1}`}
                            onClick={() => setLightbox({ urls, index: urls.indexOf(url) })}
                            style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(0,0,0,0.1)", cursor: "zoom-in" }}
                          />
                        ))}
                      </div>
                    )}

                    <div style={{ fontSize: 12, color: "#888", marginTop: 8, display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                      {r.project && <span>📦 {r.project}</span>}
                      <span>🕐 {fmt(r.created_at)}</span>
                      {r.page_url && <span>📄 {shortPage(r.page_url)}</span>}
                      {photos.length > 0 && <span>📎 {photos.length} {photos.length === 1 ? "foto" : "fotos"}</span>}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {r.status === "open" ? (
                      <button onClick={() => setStatus(r.id, "resolved")} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "none", background: "#10b981", color: "#fff", cursor: "pointer" }}>✓ Resolver</button>
                    ) : (
                      <button onClick={() => setStatus(r.id, "open")} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", background: "transparent", color: "inherit", cursor: "pointer" }}>Reabrir</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox.urls[lightbox.index]} alt="Imagen del reporte" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />

          {lightbox.urls.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setLightbox((l) => l && { ...l, index: (l.index - 1 + l.urls.length) % l.urls.length }); }}
                style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, borderRadius: "9999px", border: "none", background: "rgba(255,255,255,0.15)", color: "#fff", fontSize: 18, cursor: "pointer" }}
              >‹</button>
              <button
                onClick={(e) => { e.stopPropagation(); setLightbox((l) => l && { ...l, index: (l.index + 1) % l.urls.length }); }}
                style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, borderRadius: "9999px", border: "none", background: "rgba(255,255,255,0.15)", color: "#fff", fontSize: 18, cursor: "pointer" }}
              >›</button>
              <span style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", fontSize: 13, color: "rgba(255,255,255,0.8)" }}>
                {lightbox.index + 1} / {lightbox.urls.length}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

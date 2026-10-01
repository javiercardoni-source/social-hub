"use client"

import { useEffect, useRef, useState } from "react"
import type { ItemPublico, VitrinaPublica } from "@/lib/cos/vitrina-public"
import { textoCompartir } from "../../../../../shared/cos/vitrina"

/**
 * La vitrina: los anuncios en teléfonos como se ven en Reels, con su texto y un botón
 * «Compartir en Instagram». Desde una web no hay link que suba un video a Instagram, así que:
 *   1. celular → menú de compartir del teléfono (navigator.share con el archivo). iOS exige que
 *      share() salga del mismo toque: el video se precarga como blob cuando la tarjeta aparece.
 *      Instagram no recibe texto en historias → el texto con la mención se copia al portapapeles.
 *   2. «Ver en Instagram» si el anuncio tiene publicación (repost con la marca etiquetada).
 *   3. compu o navegador sin soporte → «Descargar».
 * Cada toque se cuenta (por empleado si llega desde Turnos con ?e=, anónimo si no).
 */
function evento(v: string, i: string | null, t: "vista" | "compartir" | "descarga" | "ver_ig", e: string | null) {
  const body = JSON.stringify({ v, i, t, e })
  try {
    if (navigator.sendBeacon) navigator.sendBeacon("/api/vitrina/evento", new Blob([body], { type: "application/json" }))
    else void fetch("/api/vitrina/evento", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true })
  } catch {
    // Contar no puede romper la página.
  }
}

const WA = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="11" fill="#1fa855" />
    <path d="M8.5 7.5c-.4 0-1 .5-1 1.4 0 1 .7 2.6 2.4 4.2 1.7 1.6 3.4 2.4 4.4 2.4.9 0 1.4-.6 1.4-1l-.1-.6-1.6-.8-.6.2-.5.7c-.8-.2-2.3-1.6-2.6-2.4l.6-.5.2-.6-.8-1.6-.6-.1z" fill="#fff" />
  </svg>
)
const CTA_TXT: Record<string, string> = {
  WHATSAPP_MESSAGE: "Enviar mensaje de WhatsApp",
  MESSAGE_PAGE: "Enviar mensaje",
  INSTAGRAM_MESSAGE: "Enviar mensaje",
}

function Tarjeta({ it, v, empleado }: { it: ItemPublico; v: VitrinaPublica; empleado: string | null }) {
  const ref = useRef<HTMLElement>(null)
  const archivo = useRef<File | null>(null)
  const [puede, setPuede] = useState<"si" | "no" | "?">("?")
  const [aviso, setAviso] = useState<string | null>(null)

  // Precarga cuando la tarjeta aparece (para que share() salga del mismo toque en iPhone).
  useEffect(() => {
    const el = ref.current
    if (!el || !it.compartir) return
    const io = new IntersectionObserver(
      async (es) => {
        if (!es.some((x) => x.isIntersecting) || archivo.current) return
        io.disconnect()
        try {
          const r = await fetch(it.compartir!)
          const b = await r.blob()
          const f = new File([b], `${v.marca.slug}-${it.nombre.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "anuncio"}.${it.tipo === "video" ? "mp4" : "jpg"}`, { type: it.tipo === "video" ? "video/mp4" : "image/jpeg" })
          archivo.current = f
          setPuede(typeof navigator.canShare === "function" && navigator.canShare({ files: [f] }) ? "si" : "no")
        } catch {
          setPuede("no")
        }
      },
      { rootMargin: "200px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [it, v.marca.slug])

  async function compartir() {
    const texto = textoCompartir({ usuario: v.marca.ig, titulo: it.titulo || it.nombre })
    try {
      await navigator.clipboard?.writeText(texto)
    } catch {
      // Sin portapapeles: igual se comparte.
    }
    const f = archivo.current
    if (!f) return
    try {
      await navigator.share({ files: [f] })
      evento(v.id, it.id, "compartir", empleado)
      setAviso(`Listo. El texto «${texto}» quedó copiado: pegalo en la historia.`)
    } catch (e) {
      if ((e as Error).name !== "AbortError") setAviso("No se pudo abrir el menú de compartir. Probá con «Descargar».")
    }
  }

  return (
    <article className="ad" ref={ref}>
      <div className="phone">
        <div className="screen" style={it.tapa ? { backgroundImage: `url(${it.tapa})` } : undefined}>
          <div className="notch" />
          {it.ver ? <video src={it.ver} poster={it.tapa ?? undefined} autoPlay muted loop playsInline preload="metadata" /> : it.tapa ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.tapa} alt="" />
          ) : null}
          <div className="top"><span>Reels</span></div>
          <div className="bottom">
            <div className="who">
              {v.marca.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.marca.logo} alt="" />
              ) : (
                <span className="ini">{v.marca.nombre[0]}</span>
              )}
              <span>{v.marca.nombre}</span>
              <small>· Publicidad</small>
            </div>
            <p className="cap">{it.cuerpo}</p>
            <div className="cta"><span>{CTA_TXT[it.cta ?? ""] ?? "Enviar mensaje"}</span>{WA}</div>
          </div>
        </div>
      </div>
      <div className="meta">
        <div className="meta-head">
          <h3>{it.nombre}</h3>
          {it.chip && <span className="chip">{it.chip}</span>}
        </div>
        {it.origenIA && <p className="ia">Ojo: esta pieza puede tener partes hechas con IA.</p>}
        {it.titulo && <p className="title">{it.titulo}</p>}
        {it.cuerpo && <p className="body">{it.cuerpo}</p>}
        {it.mensajeWa && (
          <>
            <span className="bubble-label">Le aparece escrito en WhatsApp</span>
            <div className="bubble">{it.mensajeWa}</div>
          </>
        )}
        <div className="acciones">
          {puede !== "no" && it.compartir && (
            <button type="button" className="btn ig" onClick={compartir} disabled={puede === "?"}>
              {puede === "?" ? "Preparando…" : "Compartir en Instagram"}
            </button>
          )}
          {it.permalink && (
            <a className="btn" href={it.permalink} target="_blank" rel="noopener" onClick={() => evento(v.id, it.id, "ver_ig", empleado)}>
              Ver en Instagram
            </a>
          )}
          {it.descargar && (
            <a className="btn" href={it.descargar} onClick={() => evento(v.id, it.id, "descarga", empleado)}>
              Descargar
            </a>
          )}
        </div>
        {aviso && <p className="aviso" role="status">{aviso}</p>}
      </div>
    </article>
  )
}

export function VitrinaVista({ v, empleado }: { v: VitrinaPublica; empleado: string | null }) {
  useEffect(() => {
    evento(v.id, null, "vista", empleado)
  }, [v.id, empleado])
  const color = /^#[0-9a-f]{6}$/i.test(v.marca.color) ? v.marca.color : "#e2532f"
  return (
    <div className="vt" style={{ ["--acento" as string]: color }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lilita+One&family=Nunito+Sans:opsz,wght@6..12,400;6..12,700;6..12,800&display=swap" />
      <style>{CSS}</style>
      <div className="wrap">
        <header>
          {v.marca.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.marca.logo} alt={`Logo de ${v.marca.nombre}`} />
          ) : (
            <span className="logo-ini">{v.marca.nombre[0]}</span>
          )}
          <div className="txt">
            <span className="eyebrow">{v.marca.nombre} · Publicidad en Instagram y Facebook</span>
            <h1>{v.titulo}</h1>
            {v.bajada && <p className="lede">{v.bajada}</p>}
          </div>
        </header>
        <section>
          <h2>Los anuncios</h2>
          <p className="section-note">
            Así se ven en Reels. Elegí el que más te guste y compartilo en tu historia: en el celular, «Compartir en Instagram» abre el menú del teléfono; tocá Instagram y elegí Historia o Reel.
            {v.marca.ig ? ` El texto con ${v.marca.ig.startsWith("@") ? v.marca.ig : `@${v.marca.ig}`} se copia solo: pegalo en la historia.` : ""}
          </p>
          <div className="ads">
            {v.items.map((it) => (
              <Tarjeta key={it.id} it={it} v={v} empleado={empleado} />
            ))}
          </div>
        </section>
        <footer>{v.marca.nombre}</footer>
      </div>
    </div>
  )
}

const CSS = `
.argos-fab{display:none!important}
.vt{--bg:#f6f1e7;--surface:#fffaf0;--ink:#1b1714;--muted:#6b625a;--line:#e4dccd;--chip-bg:#fbe3d9;--display:"Lilita One","Arial Rounded MT Bold",system-ui,sans-serif;--body:"Nunito Sans",system-ui,-apple-system,sans-serif;
  min-height:100vh;background:var(--bg);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.55}
@media (prefers-color-scheme:dark){.vt{--bg:#141210;--surface:#1e1a17;--ink:#f4ede2;--muted:#b0a597;--line:#342e29;--chip-bg:#3d241b;color-scheme:dark}}
.vt *{box-sizing:border-box}
.vt .wrap{max-width:1180px;margin:0 auto;padding:32px 16px 72px;display:flex;flex-direction:column;gap:40px}
.vt header{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.vt header img,.vt .logo-ini{width:76px;height:76px;border-radius:20px;flex:none;object-fit:cover}
.vt .logo-ini{display:grid;place-items:center;background:var(--acento);color:#fff;font-family:var(--display);font-size:38px}
.vt header .txt{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1 1 280px}
.vt .eyebrow{font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--acento)}
.vt h1{font-family:var(--display);font-weight:400;font-size:clamp(30px,6vw,50px);line-height:1.02;margin:0;text-wrap:balance}
.vt .lede{margin:0;font-size:18px;color:var(--muted);max-width:60ch}
.vt h2{font-family:var(--display);font-weight:400;font-size:28px;margin:0}
.vt section{display:flex;flex-direction:column;gap:18px}
.vt .section-note{margin:0;color:var(--muted);max-width:70ch}
.vt .ads{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:36px 24px}
.vt .ad{display:flex;flex-direction:column;gap:14px;min-width:0}
.vt .phone{position:relative;width:100%;max-width:280px;aspect-ratio:9/19;margin:0 auto;border-radius:34px;background:#0b0b0b;padding:9px;box-shadow:0 18px 40px -18px rgba(0,0,0,.45),inset 0 0 0 2px #2a2a2a}
.vt .screen{position:relative;width:100%;height:100%;border-radius:26px;overflow:hidden;background:#000 center/cover;color:#fff}
.vt .screen video,.vt .screen>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.vt .notch{position:absolute;top:8px;left:50%;transform:translateX(-50%);width:34%;height:18px;background:#000;border-radius:12px;z-index:3}
.vt .top{position:absolute;top:34px;left:12px;right:12px;z-index:2;font-weight:800;font-size:15px;text-shadow:0 1px 3px rgba(0,0,0,.5)}
.vt .bottom{position:absolute;left:0;right:0;bottom:0;padding:40px 12px 12px;z-index:2;display:flex;flex-direction:column;gap:8px;background:linear-gradient(to top,rgba(0,0,0,.78),rgba(0,0,0,0))}
.vt .who{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800}
.vt .who img,.vt .who .ini{width:26px;height:26px;border-radius:50%;border:1.5px solid #fff;object-fit:cover}
.vt .who .ini{display:grid;place-items:center;background:var(--acento);font-size:12px}
.vt .who small{font-weight:600;opacity:.85;font-size:11.5px}
.vt .cap{font-size:12px;line-height:1.35;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.vt .cta{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#fff;color:#111;border-radius:8px;padding:8px 10px;font-size:12.5px;font-weight:800}
.vt .cta svg{width:18px;height:18px;flex:none}
.vt .meta{display:flex;flex-direction:column;gap:8px;padding-inline:4px}
.vt .meta-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.vt .meta h3{font-family:var(--display);font-weight:400;font-size:22px;margin:0}
.vt .chip{font-size:12px;font-weight:800;padding:3px 10px;border-radius:999px;background:var(--chip-bg);color:var(--acento);white-space:nowrap}
.vt .title{font-weight:800;margin:0}
.vt .body{margin:0;color:var(--muted);font-size:14.5px}
.vt .ia{margin:0;font-size:13px;font-weight:700;color:#b42318}
.vt .bubble-label{font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-top:4px}
.vt .bubble{align-self:flex-start;max-width:100%;background:#d9fdd3;color:#111b21;border-radius:10px 10px 2px 10px;padding:8px 12px;font-size:14.5px}
.vt .acciones{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
.vt .btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border-radius:999px;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);font:800 14.5px var(--body);text-decoration:none;cursor:pointer}
.vt .btn.ig{border:none;color:#fff;background:linear-gradient(45deg,#f58529,#dd2a7b 50%,#8134af)}
.vt .btn:disabled{opacity:.6;cursor:wait}
.vt .aviso{margin:0;font-size:13.5px;color:var(--muted)}
.vt footer{color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:16px}
@media (prefers-reduced-motion:reduce){.vt .screen video{display:none}}
`

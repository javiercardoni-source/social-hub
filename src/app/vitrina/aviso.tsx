/** F11 · Estilos y avisos compartidos de las páginas públicas de vitrina (sin datos ni sesión). */
export const BASE_CSS = `
.argos-fab{display:none!important}
.vt{--bg:#f6f1e7;--surface:#fffaf0;--ink:#1b1714;--muted:#6b625a;--line:#e4dccd;--acento:#e2532f;min-height:100vh;background:var(--bg);color:var(--ink);font:16px/1.55 "Nunito Sans",system-ui,-apple-system,sans-serif}
@media (prefers-color-scheme:dark){.vt{--bg:#141210;--surface:#1e1a17;--ink:#f4ede2;--muted:#b0a597;--line:#342e29;color-scheme:dark}}
.vt .wrap{max-width:980px;margin:0 auto;padding:40px 16px 72px;display:flex;flex-direction:column;gap:28px}
.vt h1{font:400 clamp(32px,6vw,50px)/1.05 "Lilita One","Arial Rounded MT Bold",system-ui,sans-serif;margin:0}
.vt p{margin:0;color:var(--muted);max-width:60ch}
.vt .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px}
.vt a.card{display:flex;flex-direction:column;gap:10px;text-decoration:none;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:12px}
.vt a.card:hover,.vt a.card:focus-visible{border-color:var(--acento);outline:none}
.vt .tapa{aspect-ratio:9/16;border-radius:12px;background:#111 center/cover;max-height:300px}
.vt .card b{font:400 22px "Lilita One",system-ui,sans-serif}
.vt .card span{color:var(--muted);font-size:14px}
.vt .vacia{opacity:.7}
`
const FUENTES = "https://fonts.googleapis.com/css2?family=Lilita+One&family=Nunito+Sans:opsz,wght@6..12,400;6..12,700&display=swap"

export function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="vt">
      <link rel="stylesheet" href={FUENTES} />
      <style>{BASE_CSS}</style>
      <div className="wrap">{children}</div>
    </div>
  )
}

export function SinVitrina({ nombre }: { nombre: string }) {
  return (
    <Marco>
      <h1>{nombre}</h1>
      <p>Todavía no hay anuncios para compartir de {nombre}. Cuando salga una tanda nueva, aparece acá sola.</p>
    </Marco>
  )
}

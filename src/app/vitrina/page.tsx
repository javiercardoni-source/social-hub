import type { Metadata } from "next"
import { headers } from "next/headers"
import { indiceVitrinas } from "@/lib/cos/vitrina-public"
import { Marco } from "./aviso"

/** F11 · Portada de vitrina.kitchcocenter.com: las marcas y su vitrina vigente. */
export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Anuncios para compartir", robots: { index: false, follow: false } }

export default async function IndiceVitrinas() {
  const host = (await headers()).get("host") ?? ""
  const pre = host.startsWith("vitrina.") ? "" : "/vitrina"
  const marcas = await indiceVitrinas()
  return (
    <Marco>
      <h1>Anuncios para compartir</h1>
      <p>Elegí la marca, mirá sus anuncios y subí tu favorito a tu historia de Instagram.</p>
      <div className="grid">
        {marcas.map((m) => (
          <a key={m.slug} className={`card${m.titulo ? "" : " vacia"}`} href={`${pre}/${m.slug}/`}>
            <div className="tapa" style={m.tapa ? { backgroundImage: `url(${m.tapa})` } : undefined} />
            <b>{m.nombre}</b>
            <span>{m.titulo ?? "Todavía sin anuncios"}</span>
          </a>
        ))}
      </div>
    </Marco>
  )
}

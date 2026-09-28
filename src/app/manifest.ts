import type { MetadataRoute } from "next"

// Para instalar Social Hub en la pantalla de inicio del celular (Compartir → Agregar a inicio).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Social Hub · Content OS",
    short_name: "Social Hub",
    description: "Subí, aprobá y publicá el contenido de las marcas de Kitchco",
    start_url: "/inicio",
    display: "standalone",
    background_color: "#faf8f5",
    theme_color: "#ef4444",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" }],
  }
}

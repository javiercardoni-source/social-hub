import { NextResponse } from "next/server"

/**
 * Manifest propio de la app de aprobación (F12): `start_url: /app` para que, instalada desde
 * Safari ("Agregar a inicio"), abra directo en la cola — nunca en el panel completo de Social Hub.
 */
export function GET() {
  return NextResponse.json(
    {
      name: "Aprobar · Social Hub",
      short_name: "Aprobar",
      description: "Aprobá o rechazá lo que subió el motor de Content OS",
      start_url: "/app",
      scope: "/app",
      display: "standalone",
      orientation: "portrait",
      background_color: "#000000",
      theme_color: "#ef4444",
      icons: [
        { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/apple-icon", sizes: "180x180", type: "image/png" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  )
}

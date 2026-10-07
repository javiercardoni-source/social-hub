import type { Metadata, Viewport } from "next"

/**
 * F12 · Layout de la app de aprobación (/app): a propósito NO usa el layout de (dashboard), así
 * que sale sin Sidebar ni Topbar — es "100 % dedicada a aprobación" (pedido de Javier). El chequeo
 * de sesión va en cada página (page.tsx), como en el resto de Content OS.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#ef4444",
}

export const metadata: Metadata = {
  title: "Aprobar · Social Hub",
  description: "Aprobá o rechazá lo que subió el motor, desde el celular",
  manifest: "/app/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Aprobar" },
  icons: { icon: "/icon", apple: "/apple-icon" },
  // `appleWebApp.capable` de Next 16.3.7 emite "mobile-web-app-capable" (el genérico), no el
  // específico de Apple — y iOS todavía lo pide para abrir en pantalla completa sin la barra de
  // Safari. Se agrega a mano para no depender de que Next lo arregle.
  other: { "apple-mobile-web-app-capable": "yes" },
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 overflow-hidden overscroll-none bg-black text-white">{children}</div>
}

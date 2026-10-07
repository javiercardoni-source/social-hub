import type { Metadata } from "next"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Zap } from "lucide-react"
import { LoginForm } from "./login-form"

type Props = { searchParams: Promise<{ next?: string }> }

/**
 * F12: si se llega al login de camino a /app (sin sesión, o vencida), el <head> tiene que llevar
 * el manifest de /app — si no, "Agregar a inicio" hecho ACÁ (antes de loguearse) instala el ícono
 * de Social Hub completo en vez del de Aprobar, aunque después de loguearse vaya a parar a /app.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { next } = await searchParams
  if (next !== "/app") return {}
  return {
    title: "Aprobar · Social Hub",
    manifest: "/app/manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Aprobar" },
    other: { "apple-mobile-web-app-capable": "yes" },
  }
}

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Zap className="h-5 w-5" />
          </div>
          <CardTitle className="text-xl">Social Hub</CardTitle>
        </CardHeader>
        <CardContent>
          <LoginForm next={next} />
        </CardContent>
      </Card>
    </div>
  )
}

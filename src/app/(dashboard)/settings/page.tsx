import { PageHeader } from "@/components/dashboard/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Configuración"
        description="Preferencias de la cuenta y del espacio de trabajo."
      />

      <div className="space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">General</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Próximamente: zona horaria, idioma, notificaciones.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

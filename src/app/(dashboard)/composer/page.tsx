import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Calendar, Image as ImageIcon, Send } from "lucide-react"

export default function ComposerPage() {
  return (
    <>
      <PageHeader
        title="Composer"
        description="Creá una publicación y elegí en qué redes publicarla."
      >
        <Button variant="outline">
          <Calendar className="h-4 w-4" />
          Programar
        </Button>
        <Button>
          <Send className="h-4 w-4" />
          Publicar
        </Button>
      </PageHeader>

      <div className="grid gap-6 p-6 lg:grid-cols-[1fr_420px]">
        {/* Editor */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contenido</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Instagram</Badge>
              <Badge variant="secondary">Facebook</Badge>
              <Badge variant="outline">+ Agregar cuenta</Badge>
            </div>

            <textarea
              placeholder="¿Qué querés publicar?"
              className="min-h-[200px] w-full resize-none rounded-md border bg-transparent p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />

            <div className="flex items-center gap-2 border-t pt-4">
              <Button variant="outline" size="sm">
                <ImageIcon className="h-4 w-4" />
                Agregar media
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                0 / 2200 caracteres
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vista previa</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-[400px] items-center justify-center rounded-md border-2 border-dashed text-sm text-muted-foreground">
              La vista previa aparecerá acá
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Upload } from "lucide-react"

export default function MediaPage() {
  return (
    <>
      <PageHeader
        title="Biblioteca de medios"
        description="Gestioná imágenes y videos que podés reutilizar en tus publicaciones."
      >
        <Button>
          <Upload className="h-4 w-4" />
          Subir archivos
        </Button>
      </PageHeader>

      <div className="p-6">
        <Card className="flex h-[400px] flex-col items-center justify-center border-2 border-dashed bg-transparent p-8 text-center">
          <Upload className="h-10 w-10 text-muted-foreground/50" />
          <p className="mt-4 text-sm font-medium">
            Arrastrá archivos acá o hacé click para subir
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            PNG, JPG, MP4 hasta 100MB
          </p>
        </Card>
      </div>
    </>
  )
}

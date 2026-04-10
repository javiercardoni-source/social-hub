import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Plus } from "lucide-react"

const networks = [
  { name: "Instagram", key: "instagram", color: "bg-pink-500" },
  { name: "Facebook", key: "facebook", color: "bg-blue-600" },
  { name: "Twitter / X", key: "x", color: "bg-black" },
  { name: "LinkedIn", key: "linkedin", color: "bg-sky-700" },
  { name: "TikTok", key: "tiktok", color: "bg-zinc-900" },
]

export default function AccountsPage() {
  return (
    <>
      <PageHeader
        title="Cuentas conectadas"
        description="Gestioná tus cuentas de redes sociales."
      >
        <Button>
          <Plus className="h-4 w-4" />
          Conectar cuenta
        </Button>
      </PageHeader>

      <div className="p-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {networks.map((network) => (
            <Card key={network.key}>
              <CardContent className="flex items-center gap-4 p-4">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-md ${network.color} text-sm font-semibold text-white`}
                >
                  {network.name[0]}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{network.name}</p>
                  <p className="text-xs text-muted-foreground">
                    No hay cuentas conectadas
                  </p>
                </div>
                <Button variant="outline" size="sm">
                  Conectar
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </>
  )
}

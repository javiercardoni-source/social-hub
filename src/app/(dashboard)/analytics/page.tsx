import { PageHeader } from "@/components/dashboard/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Eye, Heart, MessageCircle, TrendingUp } from "lucide-react"

const metrics = [
  { label: "Impresiones", value: "—", icon: Eye },
  { label: "Engagement", value: "—", icon: Heart },
  { label: "Comentarios", value: "—", icon: MessageCircle },
  { label: "Crecimiento", value: "—", icon: TrendingUp },
]

export default function AnalyticsPage() {
  return (
    <>
      <PageHeader
        title="Analíticas"
        description="Métricas de rendimiento de tus publicaciones."
      />

      <div className="space-y-6 p-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => {
            const Icon = metric.icon
            return (
              <Card key={metric.label}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {metric.label}
                  </CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">{metric.value}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Conectá una cuenta para ver datos
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </>
  )
}

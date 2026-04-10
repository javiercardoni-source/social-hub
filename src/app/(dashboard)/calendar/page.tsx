import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ChevronLeft, ChevronRight } from "lucide-react"

const daysOfWeek = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

export default function CalendarPage() {
  // Placeholder: generate a fake month grid (35 cells)
  const cells = Array.from({ length: 35 }, (_, i) => i - 2)

  return (
    <>
      <PageHeader
        title="Calendario"
        description="Vista mensual de tus publicaciones programadas."
      >
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="min-w-[140px]">
            Abril 2026
          </Button>
          <Button variant="outline" size="icon">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </PageHeader>

      <div className="p-6">
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-7 border-b bg-muted/30">
            {daysOfWeek.map((day) => (
              <div
                key={day}
                className="p-3 text-center text-xs font-medium text-muted-foreground"
              >
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              const isCurrentMonth = day > 0 && day <= 30
              return (
                <div
                  key={i}
                  className="aspect-square border-b border-r p-2 last:border-r-0 hover:bg-muted/40"
                >
                  <span
                    className={
                      isCurrentMonth
                        ? "text-sm font-medium"
                        : "text-sm text-muted-foreground/40"
                    }
                  >
                    {isCurrentMonth ? day : ""}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </>
  )
}

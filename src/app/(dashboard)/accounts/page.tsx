import { requireMember } from "@/lib/cos/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { PageHeader } from "@/components/dashboard/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, AlertCircle, Clock, XCircle } from "lucide-react"
import { PlatformIcon as PIcon } from "@/components/ui/platform-icon"

export const dynamic = "force-dynamic"

type AccountRow = {
  id: string
  platform: string
  external_id: string
  display_name: string
  token_ref: string | null
  status: string
  last_checked_at: string | null
  last_error: string | null
  cos_brands: { name: string; color: string; slug: string } | null
}

function PlatformIcon({ platform }: { platform: string }) {
  return <PIcon platform={platform} className="h-5 w-5 text-white" />
}

function platformBg(platform: string) {
  if (platform === "instagram") return "bg-gradient-to-br from-pink-500 to-orange-400"
  if (platform === "facebook") return "bg-blue-600"
  return "bg-zinc-700"
}

function StatusBadge({ status }: { status: string }) {
  if (status === "connected")
    return (
      <Badge variant="default" className="gap-1 bg-emerald-600 text-white hover:bg-emerald-700">
        <CheckCircle className="h-3 w-3" />
        Conectada
      </Badge>
    )
  if (status === "error")
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="h-3 w-3" />
        Error
      </Badge>
    )
  if (status === "pending")
    return (
      <Badge variant="secondary" className="gap-1">
        <Clock className="h-3 w-3" />
        Pendiente
      </Badge>
    )
  if (status === "disabled")
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <XCircle className="h-3 w-3" />
        Desactivada
      </Badge>
    )
  return <Badge variant="secondary">{status}</Badge>
}

export default async function CuentasPage() {
  await requireMember("viewer")
  const db = createAdminClient()

  const { data: brands } = await db
    .from("cos_brands")
    .select("id, name, color, slug")
    .eq("active", true)
    .order("name")

  const { data: accounts } = await db
    .from("cos_social_accounts")
    .select("id, platform, external_id, display_name, token_ref, status, last_checked_at, last_error, cos_brands(name, color, slug)")
    .order("platform")

  const rows = (accounts ?? []) as unknown as AccountRow[]
  const connectedCount = rows.filter((a) => a.status === "connected").length

  // Agrupar por marca
  const byBrand: Record<string, { brand: typeof brands extends (infer T)[] | null ? T : never; accounts: AccountRow[] }> = {}
  for (const brand of brands ?? []) {
    byBrand[brand.id] = { brand, accounts: [] }
  }
  for (const acc of rows) {
    const brandName = acc.cos_brands?.name
    const brandEntry = Object.values(byBrand).find((b) => b.brand.name === brandName)
    if (brandEntry) brandEntry.accounts.push(acc)
  }

  return (
    <>
      <PageHeader
        title="Cuentas conectadas"
        description={`${connectedCount} de ${rows.length} cuentas activas`}
      />

      <div className="space-y-6 p-6">
        {/* Aviso de modo simulación */}
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-800/50 dark:bg-amber-950/20">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="text-amber-700 dark:text-amber-400">
            <strong>Modo simulación activo.</strong>{" "}
            Los posts se marcan como publicados pero no salen realmente a Meta. Para conectar las cuentas
            necesitás el System User token de Meta y aprobar el App Review.
          </div>
        </div>

        {Object.values(byBrand).map(({ brand, accounts: brandAccounts }) => (
          <Card key={brand.id}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: brand.color }}
                />
                {brand.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {brandAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin cuentas configuradas.</p>
              ) : (
                <div className="space-y-3">
                  {brandAccounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center gap-4 rounded-lg border bg-muted/20 p-3"
                    >
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${platformBg(account.platform)}`}
                      >
                        <PlatformIcon platform={account.platform} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{account.display_name}</p>
                        <p className="text-xs text-muted-foreground">
                          ID: {account.external_id}
                          {account.token_ref && (
                            <> · Token: <code className="rounded bg-muted px-1">{account.token_ref}</code></>
                          )}
                        </p>
                        {account.last_error && (
                          <p className="mt-0.5 text-xs text-red-500">{account.last_error}</p>
                        )}
                      </div>
                      <div className="shrink-0">
                        <StatusBadge status={account.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {brands?.length === 0 && (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            No hay marcas configuradas.
          </div>
        )}
      </div>
    </>
  )
}

import Link from "next/link"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { createAdminClient } from "@/lib/supabase/admin"
import { signedUrls } from "@/lib/cos/storage"
import { PageHeader } from "@/components/dashboard/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { aprendizaje, porQueAnuncio, rankearAnuncios, TIPO_TEXTO, TIPOS, type Numeros, type Revision, type TipoPropuesta } from "../../../../shared/cos/ads"
import { lunesDe } from "../../../../shared/cos/sugerencias"
import { PedirTanda, Propuestas, type PropuestaUI } from "./propuestas"

export const dynamic = "force-dynamic"

/**
 * F10 · Motor de ADS (docs/PLAN-MOTOR-ADS.md): la tanda de la semana para aprobar (E3/E4), el ranking
 * de lo que ya funcionó con su filtro de seguridad (E2) y lo que va aprendiendo el motor (E5).
 * Todo lo que se aprueba se crea en Meta PAUSADO: prender es de Javier.
 */
type AdRow = {
  id: string
  name: string | null
  creative_kind: string | null
  campaign_name: string | null
  effective_status: string | null
  thumb_key: string | null
  last_date: string | null
  totals: Partial<Numeros>
  revision: Revision | null
  media_error: string | null
  proposal_id: string | null
}

const pesos = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("es-AR")}`)

function Chip({ children, tono }: { children: React.ReactNode; tono: "ok" | "mal" | "neutro" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tono === "ok" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
        tono === "mal" && "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
        tono === "neutro" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}

export default async function AnunciosPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireMember("viewer")
  const { tab: tabRaw } = await searchParams
  const tab = tabRaw === "ranking" ? "ranking" : "propuestas"
  const brand = await getActiveBrand()
  if (!brand) {
    return (
      <>
        <PageHeader title="Anuncios" description="Lo que ya funcionó en Meta, convertido en anuncios nuevos" />
        <div className="p-4 md:p-6">
          <p className="rounded-xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">Elegí una marca arriba para ver sus anuncios.</p>
        </div>
      </>
    )
  }
  const db = createAdminClient()
  const week = lunesDe(new Date())
  const desde = new Date(Date.parse(week) - 21 * 86_400_000).toISOString().slice(0, 10)

  const [{ data: ads }, { data: props }, { data: cuentas }, { data: avisos }] = await Promise.all([
    db.from("cos_ads").select("id, name, creative_kind, campaign_name, effective_status, thumb_key, last_date, totals, revision, media_error, proposal_id").eq("brand_id", brand.id).gt("totals->>spend", "0").limit(2000),
    db.from("cos_ad_proposals").select("*").eq("brand_id", brand.id).gte("week", desde).order("created_at", { ascending: false }),
    db.from("cos_ad_accounts").select("id, name, synced_at, last_error").eq("active", true),
    db.from("cos_audit_log").select("event, created_at, details_json").eq("entity_type", "brand").eq("entity_id", brand.id).in("event", ["ads:tanda", "ads:tanda_en_meta"]).order("created_at", { ascending: false }).limit(5),
  ])
  const anuncios = (ads ?? []) as AdRow[]
  const ranking = rankearAnuncios(anuncios)
  const porId = new Map(anuncios.map((a) => [a.id, a]))
  const top = ranking.ganadores.slice(0, 20).map((g) => ({ g, a: porId.get(g.id)! }))

  // E5: lo creado por el motor contra su ganador de origen.
  const creadas = (props ?? []).filter((p) => p.status === "creada")
  const hijos = anuncios.filter((a) => a.proposal_id)
  const aprendido = aprendizaje(
    creadas.map((c) => {
      const t = hijos.filter((h) => h.proposal_id === c.id).map((h) => h.totals)
      const cpcs = t.map((x) => x.cost_per_conversation).filter((x): x is number => x != null)
      return {
        kind: c.kind as TipoPropuesta,
        nuevo: { cost_per_conversation: cpcs.length ? Math.min(...cpcs) : null, spend: t.reduce((s, x) => s + (x.spend ?? 0), 0), conversations: t.reduce((s, x) => s + (x.conversations ?? 0), 0) },
        origen: (c.source_ad_id && porId.get(c.source_ad_id)?.totals.cost_per_conversation) || ranking.habitual,
      }
    }),
  )

  const lista = (props ?? []).filter((p) => p.week === week || ["aprobada", "creando", "error"].includes(p.status))
  const keys = [
    ...lista.flatMap((p) => ((p.pieces ?? []) as { key: string | null }[]).map((x) => x.key).filter(Boolean) as string[]),
    ...top.map((x) => x.a.thumb_key).filter(Boolean) as string[],
    ...(lista.map((p) => (p.source_ad_id ? porId.get(p.source_ad_id)?.thumb_key : null)).filter(Boolean) as string[]),
  ]
  const urls = await signedUrls(keys, 3 * 3600)
  const propuestas: PropuestaUI[] = lista.map((p) => ({
    id: p.id,
    week: p.week,
    kind: p.kind,
    status: p.status,
    title: p.title,
    body: p.body,
    daily_budget: p.daily_budget == null ? null : Number(p.daily_budget),
    por_que: p.por_que,
    error: p.error,
    campaña: (p.numeros?.campaña as string) ?? null,
    conjunto: (p.numeros?.conjunto as string) ?? null,
    origenThumb: p.source_ad_id ? urls[porId.get(p.source_ad_id)?.thumb_key ?? ""] ?? null : null,
    origenNombre: p.source_ad_id ? porId.get(p.source_ad_id)?.name ?? null : null,
    piezas: ((p.pieces ?? []) as { formato: string; tipo: string; key: string | null }[]).map((x) => ({ formato: x.formato, tipo: x.tipo, url: x.key ? urls[x.key] ?? null : null })),
    meta: p.meta ?? {},
    rearmado: !!p.numeros?.rearmado,
    origenIA: !!p.numeros?.origen_ia,
  }))

  const enMeta = avisos?.find((a) => a.event === "ads:tanda_en_meta" && (a.details_json as { week?: string })?.week === week)
  const ultimaSync = (cuentas ?? []).map((c) => c.synced_at).filter(Boolean).sort().pop()

  return (
    <>
      <PageHeader title="Anuncios" description="Lo que ya funcionó en Meta, convertido en anuncios nuevos. Todo se crea PAUSADO: lo prendés vos.">
        <PedirTanda />
      </PageHeader>
      <div className="space-y-4 p-4 md:p-6">
        {enMeta && (
          <p className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            Tanda lista en Meta, pausada. Prendela desde el Administrador de anuncios (o desde el Scheduler) cuando quieras.
          </p>
        )}
        <nav className="flex gap-2" aria-label="Secciones">
          {[
            { k: "propuestas", t: `Tanda de la semana (${propuestas.filter((p) => p.week === week && p.status !== "descartada").length})` },
            { k: "ranking", t: "Ranking y filtro" },
          ].map((x) => (
            <Link key={x.k} href={`/anuncios?tab=${x.k}`} className={cn("rounded-full border px-4 py-1.5 text-sm font-semibold", tab === x.k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {x.t}
            </Link>
          ))}
        </nav>

        {tab === "propuestas" ? (
          <Propuestas propuestas={propuestas} semana={week} />
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ganadores de {brand.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Por costo por conversación de Meta, con al menos 5 conversaciones y {pesos(ranking.minimoGasto)} invertidos. Lo habitual de la marca: {pesos(ranking.habitual)} por conversación.
                  {" "}{ranking.ganadores.length} de {anuncios.length} anuncios con gasto tienen datos suficientes.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {top.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay anuncios con datos suficientes para esta marca.</p>}
                {top.map(({ g, a }, i) => {
                  const r = a.revision
                  return (
                    <div key={a.id} className="flex gap-3 rounded-xl border p-3">
                      <span className="w-6 shrink-0 pt-1 text-right text-sm font-bold text-muted-foreground">{i + 1}</span>
                      {a.thumb_key && urls[a.thumb_key] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={urls[a.thumb_key]} alt="" className="h-24 w-24 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <div className="h-24 w-24 shrink-0 rounded-lg bg-muted" />
                      )}
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="truncate text-sm font-semibold">{a.name ?? a.id}</p>
                        <p className="text-xs text-muted-foreground">{porQueAnuncio(a.totals, ranking.habitual)} Último día con gasto: {a.last_date ?? "—"}.</p>
                        <div className="flex flex-wrap gap-1">
                          {!r && <Chip tono="neutro">sin revisar</Chip>}
                          {r?.apto && <Chip tono="ok">se puede pautar tal cual</Chip>}
                          {r?.precio_quemado && <Chip tono="mal">precio sobre la pieza</Chip>}
                          {r?.sin_tacc && <Chip tono="mal">«sin TACC / gluten free»</Chip>}
                          {r?.promo_vencida && <Chip tono="mal">promo o fecha vencida</Chip>}
                          {r?.ia_generada && <Chip tono="mal">parece IA</Chip>}
                          {r?.titular && <Chip tono="neutro">titular: {r.titular}</Chip>}
                          {g.vsMarca < 1 && <Chip tono="ok">{Math.round((1 - g.vsMarca) * 100)} % más barato que lo habitual</Chip>}
                        </div>
                        {r && !r.apto && r.motivos.length > 0 && <p className="text-xs text-muted-foreground">{r.motivos.slice(0, 2).join(" · ")}</p>}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Lo que va aprendiendo el motor</CardTitle>
                <p className="text-sm text-muted-foreground">Cada anuncio creado por el motor se compara con su ganador de origen cuando junta 5 conversaciones. La tanda siguiente prioriza el tipo que más gana.</p>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {TIPOS.map((k) => (
                  <div key={k} className="rounded-lg border p-3 text-sm">
                    <p className="font-semibold">{TIPO_TEXTO[k]}</p>
                    <p className="text-muted-foreground">{aprendido[k].medidos ? `Le ganó a su origen ${aprendido[k].ganados} de ${aprendido[k].medidos} veces` : "Todavía sin anuncios medidos"}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">
              Datos de Meta (por anuncio y por día, desde dic-2025). Última lectura: {ultimaSync ? new Date(ultimaSync).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "nunca"}.
              {(cuentas ?? []).some((c) => c.last_error) && " Hay cuentas con error de lectura."}
            </p>
          </div>
        )}
      </div>
    </>
  )
}

import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { createAdminClient } from "@/lib/supabase/admin"
import { PageHeader } from "@/components/dashboard/page-header"
import { BRAND_MODULES } from "../../../../shared/cos/brand-modules"
import { normalizarDatos } from "../../../../shared/cos/datos-vigentes"
import { signedUrls } from "@/lib/cos/storage"
import { normalizarEtiquetas, tituloTema } from "../../../../shared/cos/gustos"
import { normalizarApertura } from "../../../../shared/cos/agenda"
import type { Insumo, Tema } from "./motores"
import { MarcaClient, type ModuloEstado } from "./marca-client"

export const dynamic = "force-dynamic"

export default async function MarcaPage() {
  await requireMember("approver")
  const brand = await getActiveBrand()

  if (!brand) {
    return (
      <>
        <PageHeader title="Marca" description="Branding Manager: la entrevista que define cada marca" />
        <div className="p-6">
          <div className="mx-auto max-w-md rounded-xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">
            Elegí una marca en el selector (arriba a la izquierda, o arriba en el celular) para empezar su entrevista.
          </div>
        </div>
      </>
    )
  }

  const db = createAdminClient()
  const [{ data: rows, error }, { data: b }] = await Promise.all([
    db.from("cos_brand_interviews").select("module, messages, summary_md, status").eq("brand_id", brand.id),
    db.from("cos_brands").select("brandbook_md, brandbook_status, brandbook_approved_at, datos_vigentes, datos_vigentes_at, agenda_auto, clima_historias, open_hours, open_hours_propuesta, open_hours_fuente, open_hours_at").eq("id", brand.id).single(),
  ])
  if (error) throw new Error(`No se pudo cargar la entrevista: ${error.message}`)

  // Motores visuales: referencias, tipografías, logo y biblioteca de sonido de la marca.
  const [{ data: assets }, { data: temas }, { data: fichas }] = await Promise.all([
    db.from("cos_brand_assets").select("id, kind, name, storage_key, mime, note, status, analysis, error, para").eq("brand_id", brand.id).order("created_at", { ascending: false }),
    db.storage.from("cos-media").list(`music/${brand.slug}`, { limit: 200 }),
    db
      .from("cos_music_tracks")
      .select("id, storage_key, title, duration_s, bpm, energy, genre, mood, vocals, analyzed_at, analysis_error")
      .eq("brand_id", brand.id)
      .eq("active", true),
  ])
  const fichaDe = new Map((fichas ?? []).map((f) => [f.storage_key as string, f]))
  const musicaKeys = (temas ?? []).filter((t) => /\.(mp3|m4a|wav|aac)$/i.test(t.name)).map((t) => `music/${brand.slug}/${t.name}`)
  const urls = await signedUrls([...(assets ?? []).filter((a) => a.kind === "referencia").map((a) => a.storage_key), ...musicaKeys])
  const insumos: Insumo[] = (assets ?? []).map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    url: urls[a.storage_key] ?? null,
    mime: a.mime,
    note: a.note,
    status: a.status,
    analysis: a.analysis,
    para: a.para ?? null,
    error: a.error,
  }))
  const musica: Tema[] = musicaKeys.map((k) => {
    const f = fichaDe.get(k)
    return {
      key: k,
      name: f?.title ?? tituloTema(k),
      url: urls[k] ?? null,
      // Sin fila todavía = la subió el script y el worker la registra en la próxima sincronización.
      ficha: f
        ? {
            id: f.id,
            duracion: f.duration_s != null ? Number(f.duration_s) : null,
            bpm: f.bpm != null ? Number(f.bpm) : null,
            energia: f.energy != null ? Number(f.energy) : null,
            estado: f.analysis_error ? "error" : f.analyzed_at ? "lista" : "midiendo",
            ...normalizarEtiquetas(f),
          }
        : null,
    }
  })

  const modulos: ModuloEstado[] = BRAND_MODULES.map((m) => {
    const r = rows?.find((x) => x.module === m.id)
    return {
      id: m.id,
      label: m.label,
      goal: m.goal,
      status: r ? (r.status as "in_progress" | "done") : "pending",
      messages: (r?.messages as ModuloEstado["messages"]) ?? [],
      summary: r?.summary_md ?? null,
    }
  })

  return (
    <>
      <PageHeader
        title={`Marca · ${brand.name}`}
        description="Branding Manager: te entrevista como un estratega de marca y arma el brandbook que usa la IA"
      />
      <div className="p-4 md:p-6">
        <MarcaClient
          brandName={brand.name}
          color={brand.color}
          modulos={modulos}
          brandbook={b?.brandbook_md ?? null}
          brandbookStatus={(b?.brandbook_status as "none" | "draft" | "approved") ?? "none"}
          datos={normalizarDatos(b?.datos_vigentes)}
          datosAt={b?.datos_vigentes_at ?? null}
          insumos={insumos}
          musica={musica}
          agenda={{
            auto: !!b?.agenda_auto,
            climaHistorias: b?.clima_historias !== false,
            horarios: normalizarApertura(b?.open_hours),
            propuesta: normalizarApertura(b?.open_hours_propuesta),
            fuente: b?.open_hours_fuente ?? null,
            leidoAt: b?.open_hours_at ?? null,
          }}
        />
      </div>
    </>
  )
}

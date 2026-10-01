import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { cargarVitrina } from "@/lib/cos/vitrina-public"
import { VitrinaVista } from "./vitrina-vista"

/**
 * F11 · Vitrina pública (sin login, noindex). En vitrina.kitchcocenter.com se llega por
 * /<marca>/ (la vigente) o /<marca>/<slug>/; en el panel, por /vitrina/<marca>/… (vista previa).
 * Una vitrina retirada redirige a la vigente de su marca.
 */
export const dynamic = "force-dynamic"

type Props = { params: Promise<{ marca: string; slug?: string[] }>; searchParams: Promise<{ e?: string }> }

async function base(marca: string) {
  const host = (await headers()).get("host") ?? ""
  return host.startsWith("vitrina.") ? `/${marca}/` : `/vitrina/${marca}/`
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { marca, slug } = await params
  const r = await cargarVitrina(marca, slug?.[0] ?? null)
  const v = r && "vitrina" in r ? r.vitrina : null
  return {
    title: v ? `${v.titulo}` : "Vitrina",
    description: v?.bajada,
    robots: { index: false, follow: false },
    openGraph: v ? { title: v.titulo, description: v.bajada || `Los anuncios de ${v.marca.nombre}`, images: v.items[0]?.tapa ? [v.items[0].tapa] : undefined } : undefined,
  }
}

export default async function VitrinaPage({ params, searchParams }: Props) {
  const { marca, slug } = await params
  if ((slug?.length ?? 0) > 1) notFound()
  const r = await cargarVitrina(marca, slug?.[0] ?? null)
  if (!r) notFound()
  const { e } = await searchParams
  if ("redirigir" in r) redirect(`${await base(marca)}${e ? `?e=${encodeURIComponent(e)}` : ""}`)
  const empleado = e && /^[A-Za-z0-9_-]{4,80}$/.test(e) ? e : null
  return <VitrinaVista v={r.vitrina} empleado={empleado} />
}

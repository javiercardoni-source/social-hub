import type { Metadata } from "next"
import { requireMember } from "@/lib/cos/auth"
import { getActiveBrand } from "@/lib/cos/brand"
import { cargarCalendario } from "@/lib/cos/calendario-datos"
import { CalendarioCompleto, type Vista } from "./calendario-completo"

/**
 * Calendario a pantalla completa (07-10-2026): sin la barra lateral, con vistas Día / Semana / Mes,
 * filtro por red y búsqueda. Se abre en una pestaña aparte desde Calendario.
 */
export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Calendario · Social Hub" }

const hoyBA = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
const sumar = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const dow = (dia: string) => (new Date(`${dia}T12:00:00Z`).getUTCDay() + 6) % 7 // 0 = lunes

/** Días que muestra cada vista: el día, su semana (lun a dom) o el mes en semanas enteras. */
function rango(vista: Vista, fecha: string): { desde: string; hasta: string } {
  if (vista === "dia") return { desde: fecha, hasta: fecha }
  if (vista === "semana") return { desde: sumar(fecha, -dow(fecha)), hasta: sumar(fecha, 6 - dow(fecha)) }
  const primero = `${fecha.slice(0, 7)}-01`
  const ultimo = sumar(new Date(Date.UTC(Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7)), 1)).toISOString().slice(0, 10), -1)
  return { desde: sumar(primero, -dow(primero)), hasta: sumar(ultimo, 6 - dow(ultimo)) }
}

export default async function CalendarioPantallaCompleta({ searchParams }: { searchParams: Promise<{ vista?: string; fecha?: string }> }) {
  await requireMember("viewer")
  const sp = await searchParams
  const vista: Vista = sp.vista === "dia" || sp.vista === "semana" ? sp.vista : "mes"
  const hoy = hoyBA()
  const fecha = sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) ? sp.fecha : hoy
  const brand = await getActiveBrand()
  const { desde, hasta } = rango(vista, fecha)
  const datos = await cargarCalendario(brand, desde, hasta)
  const dias: string[] = []
  for (let d = desde; d <= hasta; d = sumar(d, 1)) dias.push(d)
  return <CalendarioCompleto vista={vista} fecha={fecha} hoy={hoy} dias={dias} marca={brand ? { slug: brand.slug, name: brand.name, color: brand.color } : null} {...datos} />
}

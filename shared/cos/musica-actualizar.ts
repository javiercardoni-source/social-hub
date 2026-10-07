/**
 * Actualizar la música de lo pendiente cuando se cambia la biblioteca de una marca (07-10-2026,
 * Javier: "no importa cuántas mande a generar, se van generando un set por marca por hora, para
 * el total de las pendientes"). Un trabajo horario (worker/src/musica-actualizar.ts) elige, por
 * marca, un puñado de subidas que todavía suenan con música retirada y pide rehacerlas — nunca
 * todo junto, para no saturar la cola; se repite solo hasta que no quede ninguna.
 */

export type PiezaMusica = { id: string; origen: string; brandSlug: string; musicKey: string | null; createdAt: string }
export type SetDeMusica = { origen: string; postIds: string[] }

/** ¿Esta música ya no es la de la biblioteca activa de la marca (se movió a music-retirada/)? */
export function esMusicaRetirada(musicKey: string | null | undefined): boolean {
  return !!musicKey && musicKey.startsWith("music-retirada/")
}

/**
 * Agrupa las piezas con música retirada por subida (origen) y elige, por marca, hasta `setSize`
 * subidas — las más viejas primero, para ir en orden y que una corrida nunca re-elija al azar.
 * Devuelve solo las marcas que todavía tienen algo pendiente de actualizar.
 */
export function elegirSetDeMusica(piezas: PiezaMusica[], setSize = 3): Record<string, SetDeMusica[]> {
  const porMarca = new Map<string, Map<string, { ids: string[]; primeraVez: string }>>()
  for (const p of piezas) {
    if (!esMusicaRetirada(p.musicKey) || !p.origen || !p.brandSlug) continue
    const marca = porMarca.get(p.brandSlug) ?? new Map<string, { ids: string[]; primeraVez: string }>()
    const grupo = marca.get(p.origen) ?? { ids: [], primeraVez: p.createdAt }
    grupo.ids.push(p.id)
    if (p.createdAt < grupo.primeraVez) grupo.primeraVez = p.createdAt
    marca.set(p.origen, grupo)
    porMarca.set(p.brandSlug, marca)
  }
  const out: Record<string, SetDeMusica[]> = {}
  for (const [slug, grupos] of porMarca) {
    const elegidos = [...grupos.entries()]
      .sort((a, b) => a[1].primeraVez.localeCompare(b[1].primeraVez))
      .slice(0, setSize)
      .map(([origen, g]) => ({ origen, postIds: g.ids }))
    if (elegidos.length) out[slug] = elegidos
  }
  return out
}

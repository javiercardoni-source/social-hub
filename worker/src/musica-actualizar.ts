/**
 * music:actualizar — corre una vez por hora (worker/src/main.ts). Cuando se cambia la biblioteca
 * de música de una marca, lo pendiente sigue sonando con los temas retirados hasta que se rehace
 * el guion. En vez de mandar todo junto, cada corrida elige un set chico por marca (las subidas
 * más viejas primero) y pide `post:redo` con `otra_musica: true` — "un set por marca por hora,
 * para el total de las pendientes" (Javier, 07-10-2026). Se repite sola hasta que no quede nada.
 */
import type { Handler } from "./handlers.ts"
import { elegirSetDeMusica, type PiezaMusica } from "../../shared/cos/musica-actualizar.ts"

// Subidas por marca, por hora: unos 3-6 reels armándose en la hora (2-3 min cada uno con palabra
// por corte), el resto del tiempo libre para todo lo demás — "que no sature nada".
const SET_POR_HORA = 3

const actualizarMusicaPendiente: Handler = async (_job, { db, log }) => {
  const { data } = await db
    .from("cos_posts")
    .select("id, created_at, music_key, montaje, cos_brands(slug)")
    .eq("status", "PENDING_APPROVAL")
    .not("montaje", "is", null)
    .like("music_key", "music-retirada/%")
  const piezas: PiezaMusica[] = (data ?? []).map((p) => ({
    id: p.id as string,
    origen: (p.montaje as { origen?: string } | null)?.origen ?? "",
    brandSlug: (p.cos_brands as unknown as { slug: string } | null)?.slug ?? "",
    musicKey: p.music_key as string | null,
    createdAt: p.created_at as string,
  }))
  const sets = elegirSetDeMusica(piezas, SET_POR_HORA)
  if (!Object.keys(sets).length) return // nada con música vieja: no hay nada que hacer esta hora

  for (const [marca, subidas] of Object.entries(sets)) {
    let pedidas = 0
    for (const s of subidas) {
      const { error } = await db.rpc("cos_enqueue_job", {
        p_type: "post:redo",
        p_payload: { post_ids: s.postIds, request: "Música nueva de la marca.", otro_diseno: false, otra_musica: true, by: "sistema:musica-actualizar" },
        // Una clave por subida: si ya está pedida (de la corrida anterior, todavía en cola), no se duplica.
        p_dedupe_key: `musica:actualizar:${s.origen}`,
      })
      if (error) log("no se pudo pedir el cambio de música", { marca, origen: s.origen, error: error.message })
      else pedidas++
    }
    log("set de música pedido", { marca, subidas: pedidas })
  }
  // Si quedó algo sin elegir (más subidas que SET_POR_HORA), el próximo tic horario sigue con las
  // siguientes — no hace falta nada más acá, agendaClock() ya llama a esto cada hora sin condición.
}

export const musicaActualizarHandlers: Record<string, Handler> = { "music:actualizar": actualizarMusicaPendiente }

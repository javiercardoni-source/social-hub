# F1 — Analytics + motor de horarios · SPEC

> Pedido de Javier (28-09): "todo el sistema de analytics me importa muchísimo porque es lo que
> automáticamente va a ir guiando el motor que selecciona en qué momento es mejor subir los
> distintos tipos de material, en base a las métricas, al tipo y al contenido".

## Realidad de la API (probado 28-09 contra v26, solo lectura)
| Tipo | Métricas que SÍ entrega |
|---|---|
| IG FEED imagen | reach, views, likes, comments, saved, shares, total_interactions, follows, profile_visits |
| IG REELS | reach, views, likes, comments, saved, shares, total_interactions, ig_reels_avg_watch_time, ig_reels_video_view_total_time |
| IG STORY | reach, views, shares, total_interactions, follows, profile_visits, replies, navigation — **solo mientras vive (24 h)** |
| FB post | reactions / comments / shares (campos), post_media_view, post_total_media_view_unique, post_clicks, post_reactions_by_type_total (`post_impressions_unique` ya no existe) |
| Cuenta IG | `online_followers` y `follower_count` devuelven **vacío/0** → no se usan. Seguidores: campo `followers_count` del perfil, guardado a diario por nosotros |

## Requisitos
1. **Recolección automática** (worker, trabajo `metrics:sync` por cuenta):
   - Trae todo lo publicado (histórico completo la primera vez, paginado; después lo nuevo).
   - Guarda cada publicación (propia de Content OS o no) con tipo, formato, texto, link, fecha y
     miniatura propia (las URLs de Meta vencen).
   - Guarda **fotos de métricas en el tiempo** (no solo el último valor): permite medir velocidad.
   - Frecuencia por edad: <3 días cada 2 h · <30 días a diario · <90 días semanal · más viejo: una
     vez en el histórico. Historias vivas: cada 2 h sí o sí (se pierden a las 24 h).
   - Límites de Meta: tope de llamadas por corrida; si queda trabajo, se re-encola (reanudable,
     idempotente, sin duplicar fotos del mismo momento).
   - Seguidores de cada cuenta, una foto por día.
   - Vincula las publicaciones propias con `cos_posts` (remote_post_id).
2. **Motor de horarios** (`shared/cos/timing.ts`, funciones puras con tests):
   - Rendimiento de un post = alcance relativo a la mediana de su cuenta y formato (últimos 180 días)
     → comparable entre cuentas grandes y chicas y robusto a virales.
   - Por franja día×hora (hora de Buenos Aires): promedio con **contracción bayesiana** hacia un
     efecto base (hora × día) para no creerle a franjas con 1 o 2 posts. Confianza según cantidad.
   - Sugerencias: las mejores 3 franjas de los próximos 7 días para una cuenta+formato, con
     "+X% sobre tu promedio" y nivel de confianza; nunca en el pasado.
   - Sin datos suficientes: lo dice ("todavía poca data") en vez de inventar.
   - Por tipo de contenido: cuando exista la clasificación (F2 clasifica lo importado), se suma la
     dimensión categoría. En F1: formato (post, reel, historia, carrusel).
3. **Pantalla Métricas** (`/analytics`), respeta la marca elegida:
   - Últimos 30 días: publicaciones, alcance total, alcance promedio por formato, tasa de
     interacción, seguidores hoy vs hace 30 días (cuando haya historia de nuestra foto diaria).
   - Mapa de calor día×hora (rendimiento relativo), mejores franjas por formato.
   - Top publicaciones (miniatura, alcance, interacción, link) y las de Content OS vs el promedio.
   - Estado de la recolección (última sincronización, errores).
4. **Aprobaciones**: al elegir "Programar", chips con las 3 mejores franjas sugeridas para esa
   cuenta y formato; tocar uno fija la fecha.

## Fuera de alcance F1
Publicar automáticamente en la franja sugerida sin aprobación (siempre hay aprobación humana).
Clasificación por IA del histórico (F2). Contexto anual/clima (F4).

## Aceptación
- Backfill de las 3 cuentas IG + 3 FB completo, sin errores sin manejar, reanudable.
- La historia viva de FasutoFudo queda con métricas guardadas.
- Tests del motor: contracción, ranking, zona horaria AR, sin datos, franjas pasadas excluidas.
- `/analytics` y sugerencias en Aprobaciones funcionando con datos reales, en compu y celular.
- gauntlet local verde + críticos (Data, Domain/estadística, Integración, UX) sin P0/P1 +
  gauntlet:prod verde.

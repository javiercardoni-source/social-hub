# F7 · Motor de gustos: traspaso para quien lo construye

> Escrito el 30-09-2026 al cerrar el plan con Javier. **La spec manda:** `spec.md` (en esta
> misma carpeta). Este archivo tiene el contexto del código y los prompts de cada entrega.

## 0. Reglas del proyecto (no negociables)

- Repo: `~/Dev/social-hub` (NO la carpeta vieja de iCloud). Leé `CLAUDE.md`, `AGENTS.md`
  (Next 16: leer `node_modules/next/dist/docs/` antes de escribir código de Next), `GAUNTLET.md`
  y `PLAN-CONTENT-OS.md`.
- **Gauntlet:** SPEC → … → PASS. Críticos = subagentes independientes que **leen TODAS las
  migraciones** antes de afirmar algo sobre la base. Todo hallazgo se verifica contra el código.
  Hallazgos en `.gauntlet/findings.md`, estado en `.gauntlet/status.md`.
- **No se entrega sin `npm run gauntlet` verde** (y `npm run gauntlet:prod` después del deploy).
- **Avisar y esperar OK de Javier antes de:** aplicar migraciones en producción, deployar
  (`./infra/deploy.sh social-hub` desde `~/Documents/Sistema Kitchco/`), o tocar borradores o
  datos suyos. Las pruebas usan datos propios que se borran al final.
- **Regla de modelos** (tabla en `CLAUDE.md`): al empezar cada bloque, decir en una línea qué
  modelo corresponde. M0, M1-lógica, M2 y la lógica de candidatos a pauta: **Opus**. Pantallas y
  prompts de sugerencias: **Sonnet**. Revisar: **Fable**.
- Errores de server actions en prod: usar `aviso()` (`src/lib/aviso.ts`) + `explicarError`; Next
  oculta el texto de los errores lanzados.
- Comentarios en castellano, TS estricto, `npm test` después de cada cambio significativo.

## 1. Mapa del código relevante (relevado el 29-09)

**Métricas (F1)**
- Tablas (0007): `cos_media` (todo lo publicado, sea de Content OS o no: `format`, `posted_at`,
  `metrics` jsonb con el último valor, `post_id` → `cos_posts`, `thumb_key`; 0017 agrega
  `con_texto`) · `cos_media_metrics` (serie: `media_id, captured_at, age_hours, data`, única por
  hora) · `cos_account_daily` (seguidores por día).
- Recolección: `worker/src/metrics.ts` (`syncAccount`, líneas 98-269; métricas pedidas en
  33-39; FB en 272-293). Job `metrics:sync` (handlers.ts:743-772), reloj en `worker/src/main.ts:133-152`.
  Frecuencias en `shared/cos/metrics-due.ts`.
- IG entrega: reach, views, likes, comments, saved, shares, total_interactions, follows,
  profile_visits, `ig_reels_avg_watch_time` (reel) y replies + navigation (historia). **No se
  pide hoy** `ig_reels_video_view_total_time` (la spec F1 dice que está disponible) ni
  `post_clicks` de FB: sumarlos en M1.
- Vínculo post ↔ métricas: `cos_media.post_id` (se completa en metrics.ts:255-259). Los posts
  simulados (`simulado_<id>`) nunca se vinculan. Lo importado del IG viejo:
  `cos_assets.origin_media_id` → `cos_media`.
- **Motor de horarios:** `shared/cos/timing.ts` (`lifts` = alcance ÷ mediana de su formato en
  ±60 días, acotado entre 0,1 y 4 · `slotModel` = contracción bayesiana día×hora ·
  `suggestSlots`). Lo consumen `src/lib/cos/analytics.ts` (`perfValue`, `modelFor`,
  `suggestionsFor`), `/analytics` y `/aprobaciones`. **F7 se monta encima: no duplicarlo.**

**Música**
- **No hay tabla.** Archivos en el bucket `cos-media`, carpeta `music/<slug>/`. Se suben con
  `scripts/musica-subir.mjs` o desde Marca → Motores (`src/lib/cos/motores-actions.ts:25`,
  72-75; borrar en 155-170). Se listan con `listMusic` (handlers.ts:382-385).
- **Se elige al azar** en tres lugares: `post:draft` (handlers.ts:324-326), `post:redo` con
  `otra_musica` (712-718) y `holiday:stories` (896).
- Queda en `cos_posts.music_key` (ruta en el bucket, **entra en el hash de aprobación** desde
  0004/0008). El cambio manual en Aprobaciones valida el prefijo (actions.ts:~83-125).
- Render: `worker/src/render.ts` (baja la pista en :81; `music_key` entra en la clave del render
  en :52) · `finishVideo` (media.ts:200) · `photoToReel` (media.ts:172). La foto del feed de IG
  no lleva música (la API no lo permite).

**Imágenes**
- `cos_assets.ai_json` (schema `Classification`, `worker/src/ai.ts:12-25`): summary, category,
  products[], topics[], mood[], people_present, quality_score, commercial_value,
  suggested_formats[], risk_flags[]… Prompt en `shared/cos/prompts.ts:58-94`. Job
  `asset:classify` (handlers.ts:206-262); lo de archivo usa `ai_model_light` (Haiku).
- Selección automática existente: solo las historias de feriado (handlers.ts:855-871, mejor
  `quality_score`).
- `ref:analyze` ya calcula `sceneCuts` con ffmpeg (sirve para medir el ritmo de un video).

**Infra**
- Cola: `cos_jobs` + RPC `cos_enqueue_job(p_type, p_payload, p_run_at, p_dedupe_key,
  p_max_attempts)`. Worker: `queue.enqueue(type, payload, {runAt, dedupeKey})`,
  `PermanentError` evita los reintentos. Handlers registrados en el mapa de handlers.ts:1408-1431.
- Tareas periódicas: `setInterval` en `worker/src/main.ts` + enqueue con dedupe por ventana.
  Copiar el patrón de `metrics:sync`.
- IA: `worker/src/ai.ts` → `messages.parse` + `zodOutputFormat`, `brandSystemPrompt(brand)` con
  cache, `logUsage` → `cos_ai_usage`. Modelos desde `cos_settings.ai_model` / `ai_model_light`.
- Migraciones: la próxima es la **0018**. Se aplican con `npm run db:migrate` (Supabase CLI
  linkeado a OlivosSpeed `jhftgcjiymjcamjikuwe`). Los tests corren todas en PGlite.
- Pantallas: `src/app/(dashboard)/{analytics,aprobaciones,marca,media,feed}/`.
- Marcas activas: sensaciones, bijutsukan, fasutofudo (StohrBurgers dada de baja).

## 2. Prompts por entrega

Pegar **uno por vez** en la otra ventana. Cada entrega cierra con PASS antes de la siguiente.

### Prompt M0: fichas y registro (Opus)

```text
Trabajás en ~/Dev/social-hub (Content OS). Vas a construir la entrega M0 de la feature F7
«Motor de gustos». Antes de escribir nada, leé en este orden: CLAUDE.md, AGENTS.md, GAUNTLET.md,
.gauntlet/features/f7-motor-gustos/spec.md y .gauntlet/features/f7-motor-gustos/HANDOFF.md
(tiene el mapa del código con archivo:línea y las reglas). Leé también TODAS las migraciones de
supabase/migrations/ antes de diseñar la 0018.

Objetivo de M0: que la música y las imágenes tengan una ficha, y que cada post quede vinculado
al tema exacto que usó. Sin esto el motor no tiene de qué aprender.

1. Migración 0018_cos_gustos.sql:
   - cos_music_tracks (id, brand_id, storage_key UNIQUE, title, duration_s, bpm, energy,
     genre, mood text[], vocals, source_url, license, active, analyzed_at, created_at). RLS
     igual que el resto (lectura cos_members, escritura solo del servidor).
   - Backfill de una fila por cada archivo que hoy está en cos-media/music/<slug>/. Si el SQL
     no puede listar el Storage, hacelo con un job o script idempotente.
   - cos_posts + music_track_id (FK), con backfill desde music_key + pick_json jsonb (lo usa M2).
     OJO: music_key entra en el hash de aprobación. music_track_id NO tiene que cambiar el hash
     ni devolver a aprobación posts ya aprobados. Verificalo con un test en PGlite.
   - cos_assets + traits jsonb + traits_version int.
   - cos_taste_models y cos_suggestions (esquema de la spec): se crean ahora para no hacer otra
     migración en M1/M3.
2. Worker, job music:analyze: con ffmpeg/ffprobe calcula duration_s, bpm (autocorrelación de
   onsets o equivalente; si no es confiable, dejalo null y decilo) y energy (RMS normalizado
   0-1). Se dispara al subir un tema (motores-actions + musica-subir.mjs) y en un backfill de
   los existentes. Idempotente.
3. Toda subida o borrado de música mantiene cos_music_tracks sincronizada (motores-actions.ts,
   scripts/musica-subir.mjs, borrarMusica). Donde hoy se escribe music_key (post:draft,
   post:redo, holiday:stories, cambio manual en Aprobaciones) escribí también music_track_id.
   La elección sigue AL AZAR en M0: no cambies la lógica de selección.
4. Pantalla Marca → Motores → Sonido: cada tema muestra su ficha (duración, BPM, energía) y
   chips para marcar a mano género (house, jazz, lounge, lo-fi, urbano, oriental, pop, otro),
   mood (relajado, arriba, elegante, divertido, romántico) y voz/instrumental. Vocabulario
   CERRADO en shared/cos/ (una sola fuente para la web y el worker). Tiene que andar en el celular.
5. Rasgos de imagen: extendé el schema Classification y el prompt (shared/cos/prompts.ts) con
   vocabulario cerrado: plano (primer_plano|cenital|medio|ambiente), protagonista
   (producto|manos_proceso|persona|local|placa), accion (vapor|corte|armado|salsa|servido|nada),
   luz_temp (calida|fria), luz_nivel (clara|oscura), fondo (limpio|cargado); en video, ritmo
   (cortes por segundo, reusá sceneCuts de ref:analyze) y duración. Guardá en cos_assets.traits
   con traits_version=1. NO rompas lo que hoy lee ai_json.
6. Job traits:backfill: reclasifica los assets existentes (incluidos los importados de IG) solo
   para sacar traits, con ai_model_light (Haiku), por tandas, reanudable, con tope de costo
   configurable. Registra el consumo en cos_ai_usage. NO lo corras en producción: dejalo listo y
   calculá el costo estimado (spec: ≈ USD 15).

Tests (vitest + PGlite): la migración aplica limpia sobre 0001-0017 · backfill de
music_track_id · el hash no cambia · vocabulario cerrado (un valor fuera de la lista se
descarta) · music:analyze sobre un wav de prueba generado en el test · traits:backfill es
idempotente y respeta el tope.

Proceso Gauntlet: implementá → npm run gauntlet verde → lanzá críticos independientes (Data
Critic: migración/RLS/hash; Integration Critic: jobs/idempotencia; UX Critic: chips en celular)
que lean TODAS las migraciones → verificá cada hallazgo contra el código → corregí → anotá en
.gauntlet/findings.md y .gauntlet/status.md.

NO apliques la migración en producción, NO deployes y NO corras traits:backfill en prod: cuando
esté todo verde, avisale a Javier con el resumen, el costo estimado del backfill y los comandos
exactos, y esperá su OK. No hagas commit sin que Javier lo pida.
```

### Prompt M1: el motor aprende y pestaña Gustos, solo lectura (Opus la lógica, Sonnet la pantalla)

```text
Trabajás en ~/Dev/social-hub. Entrega M1 de F7 «Motor de gustos». Leé
.gauntlet/features/f7-motor-gustos/spec.md y HANDOFF.md, y el estado de M0 en
.gauntlet/status.md (tiene que estar PASS). Leé shared/cos/timing.ts completo: el motor nuevo
se monta encima de ese, no lo duplica.

1. Sumá a metrics:sync las métricas que faltan: ig_reels_video_view_total_time (reels) y
   post_clicks (FB). Respetá los topes de llamadas y verificá primero contra la API real con
   una llamada de solo lectura.
2. shared/cos/taste.ts (funciones puras, sin dependencias, usables en web y worker):
   - scoreAt(media, series): métricas a edad fija (48 h en feed/reel/carrusel, último valor en
     historias) tomadas de cos_media_metrics. Si falta la foto de las 48 h, interpolá con la
     más cercana y marcá la calidad del dato.
   - Lifts POR MÉTRICA (vistas/alcance, interacción ponderada likes×1 + comentarios×2 +
     guardados×3 + compartidos×3, retención = avg_watch_time/duración, follows,
     profile_visits, respuestas, clics), cada uno vs lo esperado en su época y formato
     (reusá lifts de timing.ts), divididos por el efecto de su franja (slotModel) = residuo de
     contenido.
   - Objetivos gusta/crece/conversa (pesos de la spec, editables por marca): media geométrica
     ponderada de los lifts.
   - Efecto por rasgo (marca × formato × objetivo): media del log-residuo con contracción
     bayesiana hacia 0 + intervalo, n y confianza alta/media/baja con los mismos umbrales que
     timing.ts.
   - Con ≥150 posts en marca+formato: ridge sobre todos los rasgos a la vez; si no, efecto
     simple con advertencia de confusión.
   - Un tema de música sin historia hereda el efecto de sus rasgos (género, mood, bpm por
     tramos, energía por tramos).
   - Desgaste: penalización por uso en los últimos N posts de la marca.
   - Excluir: simulados, borrados, pautados (averiguá si la API permite detectarlo; si no,
     dejá una marca manual en cos_media) e historias sin foto final.
3. Job taste:learn diario (dedupe por día y marca) → guarda en cos_taste_models con n y
   computed_at.
4. BACKTEST obligatorio (script + test): entrenar hasta el mes X, predecir X+1, comparar el
   error contra el baseline «mediana de siempre». Reportá el resultado por marca y formato. Si
   no le gana al baseline en imágenes, anotalo: M2 no podrá elegir imágenes (regla de la spec).
5. Pantalla (Sonnet): pestaña «Gustos» en /analytics, respetando la marca elegida: barras de
   efecto por rasgo ± incertidumbre, «todavía poca data» cuando corresponda, música top y
   gastada, selector de objetivo, cambios del mes. Solo lectura. Compu y celular.

Tests: el residuo descuenta la franja · contracción con 1-2 posts · herencia de rasgos ·
desgaste · exclusiones · sin datos → poca data · zona horaria AR.
Críticos: Data Critic + Domain Critic (¿tiene sentido estadístico? ¿hay fuga de datos del
futuro en el backtest?) + UX Critic. Mismo cierre que M0: gauntlet verde, avisar a Javier
antes de migrar o deployar, sin commit hasta que lo pida.
```

### Prompt M2: el motor elige (Opus)

```text
Trabajás en ~/Dev/social-hub. Entrega M2 de F7. Leé spec.md, HANDOFF.md y el resultado del
backtest de M1 en .gauntlet/ (si el motor no le ganó al baseline en imágenes, en M2 elige SOLO
música y dejá la selección de imagen detrás de un switch apagado).

1. shared/cos/pick.ts (puro): filtro duro (brandbook/reglas, consentimiento, calidad mínima,
   duración compatible, música solo de la misma marca, activa) → muestreo de Thompson sobre el
   efecto ± incertidumbre del objetivo «gusta» → desgaste. Tope de exploración 30 %
   (configurable en cos_settings) y 0 % si el post tiene campaign (feriado, campaña) o es una
   fecha especial. Devuelve el elegido + pick_json (candidatos, puntajes, aprovechar/probar,
   versión del modelo).
2. Reemplazá los Math.random() de música en post:draft, holiday:stories y post:redo («otra
   música» = el siguiente mejor distinto al actual). Imagen: portada/primera del carrusel,
   historia de feriado (hoy solo quality_score) y candidatos del Archivo.
3. Guardá pick_json en cos_posts. Cambiar la música sigue devolviendo a aprobación (hash). Si
   Javier cambia la elección en Aprobaciones, registrá el override (qué eligió el motor y qué
   eligió él) para que taste:learn lo use como señal de preferencia de marca.
4. Aprobaciones: chip «🎵 <tema> · elegida por el motor (+18 % en reels, confianza media)» o
   «🧪 Probando: <tema>». Compu y celular.

Tests: nunca elige fuera del filtro · la exploración converge al tope en N sorteos (test con
semilla) · 0 % en campañas · redo no repite · pick_json completo · hash y aprobación intactos
· idempotencia de post:draft (reintento = misma elección, usá una semilla derivada del post).
Críticos: Idempotency, Data, Domain y UX. Al cerrar M2, pedile a Javier un check con Fable
(/model claude-fable-5) antes de deployar. Mismo cierre: avisar antes de migrar o deployar.
```

### Prompt M3: sugerencias y candidatos a pautar (Sonnet; la lógica de candidatos, Opus)

```text
Trabajás en ~/Dev/social-hub. Entrega M3 de F7. Leé spec.md (secciones «Qué sugiere» y
«Candidatos a pautar») y HANDOFF.md. M2 tiene que estar PASS.

1. Candidatos a pautar (lógica pura, Opus): publicaciones orgánicas de los últimos 14 días con
   lift alto y confianza suficiente en sus primeras 48 h, clasificadas por objetivo
   (crece/conversa/vende) según qué métricas las destacan. Excluir: historias, lo ya pautado y
   lo que menciona una promo/precio que no está en cos_brands.datos_vigentes. Solo sugiere:
   ninguna llamada a la API de Ads.
2. Job taste:suggest semanal (lunes, por marca) → cos_suggestions: plan de la semana (3-5
   piezas concretas con formato, rasgos, música y franja de suggestSlots), material a pedir a
   los empleados, música a bajar/retirar, candidatos a pautar. La IA REDACTA a partir de la
   tabla de efectos que le pasás; tiene prohibido inventar cifras (validá que cada número del
   texto exista en el input). Registrá el consumo en cos_ai_usage.
3. Pantalla: en la pestaña Gustos, secciones «Esta semana», «Pedir a la cocina», «Música» y
   «Para pautar», con botón útil / no útil (feedback en cos_suggestions). Compu y celular.

Tests: candidatos respetan exclusiones · número inventado en el texto → se rechaza · job
idempotente por semana. Críticos: Domain (¿las sugerencias son accionables y fieles a la
marca?), UX. Mismo cierre que antes.
```

### M4: optimizar por ventas

Queda para cuando la Fase 3 esté prendida (atribución `/r/` → pedido). Se escribe su prompt
en ese momento.

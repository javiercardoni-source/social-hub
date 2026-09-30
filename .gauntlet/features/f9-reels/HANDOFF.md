> ✅ **Etapas 1 y 2 CONSTRUIDAS Y EN PRODUCCIÓN el 30-09-2026** (commits 7abd431 y siguientes, migración 0019). Estado y hallazgos 34-41 en `.gauntlet/`. Falta la prueba final con Javier (§5): aprobar el reel de prueba de FasutoFudo que quedó en Aprobaciones.

# F9 · Video primero (motor de reels): traspaso para quien lo construye

> Escrito el 30-09-2026 al cerrar las pruebas con Javier. **La spec manda:** `spec.md` (en esta
> carpeta). Los prompts están en `docs/reels/prompts.md` y el motor probado en
> `docs/reels/referencia/reel-motor.ts`.
>
> ⚠️ **En paralelo hay otra feature en curso: F7 Motor de gustos** (`.gauntlet/features/f7-motor-gustos/`)
> y **F8 Agenda**. F7 ya tomó la migración `0018` y toca `worker/src/handlers.ts`, `ai.ts`,
> `media.ts`, `prompts.ts`, `metrics.ts` y `main.ts`. **Coordinar antes de tocar esos archivos**
> (sobre todo la elección de música: F7 la va a elegir por métricas; F9 la pide al guion — ver §6).

## 0. Reglas del proyecto (no negociables)

- Repo: `~/Dev/social-hub`. Leé `CLAUDE.md`, `AGENTS.md` (Next 16: leer
  `node_modules/next/dist/docs/` antes de escribir código de Next), `GAUNTLET.md` y
  `PLAN-CONTENT-OS.md`.
- **Gauntlet:** SPEC → DESIGN → IMPLEMENT → TEST → CRITIC → FIX → REGRESSION → VERIFY → PASS.
  Críticos = subagentes independientes que **leen TODAS las migraciones** antes de afirmar algo
  de la base; **todo hallazgo se verifica contra el código** (hubo muchos falsos positivos).
  Hallazgos en `.gauntlet/findings.md` (numeración correlativa), estado en `.gauntlet/status.md`.
- **No se entrega sin `npm run gauntlet` verde** y **`npm run gauntlet:prod` verde después del deploy**.
- **Avisar y esperar OK de Javier antes de:** aplicar migraciones en producción
  (`npm run db:migrate`), deployar (`./infra/deploy.sh social-hub` desde `~/Documents/Sistema Kitchco/`)
  o tocar borradores/datos suyos. Las pruebas usan datos propios que se borran al final.
- **Regla de modelos** (tabla en `CLAUDE.md`): decir en una línea qué modelo corresponde a cada
  bloque. Motor + integración en el worker: **Opus**. Pantallas: **Sonnet**. Revisión: **Fable**.
- Errores de server actions: `aviso()` (`src/lib/aviso.ts`) + `explicarError` (Next oculta el
  texto de los errores en producción).
- Comentarios en castellano, TS estricto, `npm test` después de cada cambio significativo.
- **Nada de Creatomate:** se probó (clave en `.credentials/creatomate.txt`, cuenta de prueba) y
  no aportó diferencia visible; Javier eligió el motor propio. No gastar créditos.

## 1. Qué pidió Javier (textual, 30-09)

- "Nuestro motor es excelente para lo que hacemos y con el tiempo lo podemos hacer mejor."
- "Me gustaría que nos basemos más en **video siempre**; foto en los post casi no se usa. Tienen
  que tener una **imagen primera** pero pueden tener **sonido y movimiento**."
- Probó y aprobó el estilo de estos tres reels (mirarlos antes de empezar):
  - Reel desde un video (Sensa15.mp4): `https://f002.backblazeb2.com/file/creatomate-c8xg3hsxdu/21b1d70e-ad1a-4ba2-9b95-966f1b35a1c3.mp4` (versión Creatomate, baja resolución)
  - Reel con gente (Social.mp4), versión motor propio: `cos-media/pruebas/reel-sensaciones-nuestro-motor.mp4`
  - Reel desde 5 fotos, versión motor propio: `cos-media/pruebas/reel-fotos-nuestro-motor.mp4`
  (los dos últimos están en el bucket privado: generar URL firmada con el service role).

## 2. Lo que ya está hecho (commit de este traspaso)

| Archivo | Qué |
|---|---|
| `shared/cos/reel.ts` | Tipos del guion (`GuionReel`, `Toma`), `normalizarGuion()` (deja el guion de la IA dentro de lo posible: tomas 1,5–3,2 s dentro del video, fuentes que existen, textos cortos en mayúsculas sin hashtags/emojis, recuadro de la lista, música que exista) y `lineaDeTiempo()` (inicios con transiciones superpuestas + cierre). **Falta sumar `combo`** (ver prompts §3). |
| `tests/shared/reel.test.ts` | 5 tests de lo anterior. |
| `worker/src/overlay.ts` → `kitDeMarca(slug, custom)` | El kit de la marca para el motor: tipografías (las cargadas en Marca → Motores si hay; si no, las de `KITS`), colores de etiqueta, logo (data URL + proporción) o `null`. Sensaciones: sin logo ni nombre. |
| `docs/reels/referencia/reel-motor.ts` | **El motor que se probó**, listo para llevar a `worker/src/reel.ts`: clips de video con acercamiento, fotos con Ken Burns, textos y cierre con satori, unión con xfade, música. |
| `docs/reels/prompts.md` | Prompt del guion (con reglas de marca), esquema de salida, caption, de dónde sale cada dato del cierre. |

## 3. Qué construir

### Etapa 1 — motor y "Usar" en video
1. **`worker/src/reel.ts`**
   - `fuentesParaGuion()`: por fuente, cuadros para la IA (foto → la foto a 512 px; video →
     `sceneCuts()` + un cuadro al medio de cada toma, máx. 6, con `framesAt()`).
   - `planearReel()`: llamada del prompt §1 (`messages.parse` + zod, `max_tokens` 12000) →
     `normalizarGuion()`. Registrar uso con `logUsage(…, "reel:plan")`.
   - `armarReel()`: portar `docs/reels/referencia/reel-motor.ts`, tomando fuentes/tipografías/
     colores de `kitDeMarca()`. Logo: si la marca tiene, va en el cierre (FasutoFudo mascota,
     Bijutsukan logo blanco); Sensaciones sin firma.
2. **Migración `0019_cos_reels.sql`** (0018 es de F7): `cos_posts.montaje jsonb` (el guion) y
   `cos_settings.foto_fija boolean not null default false` (post de foto fija apagado por defecto).
   El guion **no** entra en el hash de aprobación; `overlay_text` (= gancho) y `music_key` sí.
3. **`post:draft`** (handlers.ts): si `foto_fija` es false, con la foto o el video del asset →
   guion con 1 fuente → borradores **IG reel + IG historia + FB video**, todos con `montaje`,
   `overlay_text = gancho`, `music_key = music/<slug>/<guion.musica>`, `template = "none"`.
   Caption con `writeCaption({ postType: "reel", … })`. Clima: la historia lleva `overlay_clima`
   como gancho si corresponde (regla actual). Idempotencia igual que hoy.
4. **`post:render`**: si el post tiene `montaje` → armar el reel (no la plantilla):
   - clave `renders/<post>/<hash>.mp4` con hash de `montaje + overlay_text + music_key +
     kit.version + JSON(KITS[slug]) + RENDER_VERSION` (así un cambio de frase, música o diseño
     rearma solo; lección del 29-09).
   - Fuentes: TODAS las `cos_post_media` del post en orden de `position` (`loadRenderPost` hoy
     trae solo la primera).
   - Al terminar: `render_key`, `render_qa: { skipped: "reel" }` (o, mejor, `reviewPiece` sobre
     el cuadro de la tapa), `first_render_at` (una sola vez).
5. **Publicación:** ya publica la pieza aprobada tal cual (`render_key` si existe). Verificar
   reel IG, historia IG (video ≤ 60 s) y video FB con piezas de 12–16 s.
6. **Aprobaciones:** para posts con `montaje`, ocultar banda/etiqueta/firma/posición; mostrar
   gancho editable, música, el `por_que` de cada toma y la duración.
7. **Precio y pie del cierre:** solo de Datos vigentes (prompts §3). Nunca un precio de ejemplo.

### Etapa 2 — varias piezas y tapa
1. **"Armar reel"**: selección múltiple (ya existe la grilla con tilde en Archivo:
   `src/app/(dashboard)/media/archivo-grid.tsx`; sumar lo mismo a "De la cocina") → acción que
   encola `reel:build { asset_ids[] }` → guion con N fuentes → borradores como en la etapa 1
   (`cos_post_media` con varias posiciones). Validar: misma marca, sin consentimiento bloqueado,
   máx. 8 fuentes, videos ≤ 48 MB.
2. **Tapa:** primer cuadro con el gancho bien legible; al publicar el reel mandar `thumb_offset`
   (ms) al momento en que el gancho está entero (~1,2 s). Confirmar el parámetro en la API de
   Meta v26 (Reels) con una llamada real de solo lectura antes de codear.

## 4. Lecciones de las pruebas (evitan horas)

- ffmpeg para UN cuadro a archivo: `-frames:v 1 -update 1` (si no, "cannot write more than one file").
- `scale=...:eval=frame` con `h=-2` rompe el crop del primer cuadro: dar **w y h** explícitos (`iw*z`, `ih*z`).
- El espaciado de letras: satori lo respeta (`letterSpacing`); Creatomate no lo aplicaba.
- satori no lee WOFF2 (Motores ya lo valida).
- Supabase corta subidas en ~50 MB aunque el bucket diga 500: `compactVideo()` en media.ts.
- Worker: 1 CPU y **1,5 GB desde el 30-09** (con 768 MB la unión final murió por memoria: hallazgo 40). Un reel de 15 s tarda ~15 s en una Mac y **~65 s en el server** (medido):
  usar `-preset veryfast` en clips y `medium` solo en la unión.
- La IA a veces propone cosas contra el brandbook ("BRINDIS DE AMIGOS", "RECIÉN HECHO"): las
  reglas van en el prompt **y** un filtro de palabras en `normalizarGuion` (sumar: brindis, vino,
  recién hecho, últimos, agotar, cupos).
- Fotos horizontales en 9:16: el Ken Burns con `scale=1350:2400:force_original_aspect_ratio=increase`
  deja margen para moverse sin bordes negros.

## 5. Plan de pruebas (Gauntlet)

- Unit: `normalizarGuion` (combo, filtro de palabras), hash del reel (cambia con gancho/música/kit),
  armado de la lista de fuentes desde `cos_post_media`.
- Integración local: un reel real **por marca** (Sensaciones sin firma, FasutoFudo con mascota,
  Bijutsukan con logo), desde 1 video, desde 1 foto y desde 5 fotos. Revisar a ojo cuadros en
  0,5 s / medio / cierre (`ffmpeg -ss … -frames:v 1`).
- Crítico independiente (subagente) sobre el diff completo.
- `npm run gauntlet` → avisar a Javier → migrar → deploy → `npm run gauntlet:prod`.
- Prueba final con Javier: "Usar" en una foto de FasutoFudo (marca de prueba) → reel en
  Aprobaciones → aprobar programado → verificar publicación.

## 6. Coordinación con F7 (Motor de gustos)

F7 va a elegir la música (y la imagen) por métricas. Hasta que F7 exponga su selector, F9 usa la
música que propone el guion. Cuando exista, `planearReel()` recibe la lista ordenada por F7 y
la IA elige entre las 3 primeras. Registrar en `.gauntlet/decisions.md` lo que se acuerde.

## 7. Prompt para arrancar (pegar en la sesión de Claude Code del developer)

```
Vas a construir F9 "Video primero: motor de reels" en ~/Dev/social-hub con el protocolo Gauntlet.
Leé en este orden: CLAUDE.md, AGENTS.md, GAUNTLET.md, .gauntlet/features/f9-reels/spec.md,
.gauntlet/features/f9-reels/HANDOFF.md, docs/reels/prompts.md, docs/reels/referencia/reel-motor.ts,
shared/cos/reel.ts y .gauntlet/features/f7-motor-gustos/spec.md (hay otra feature en paralelo:
no pises sus archivos sin coordinar; tu migración es 0019).
Empezá por la Etapa 1. Antes de escribir código, decime qué modelo corresponde a cada bloque y
el plan de archivos. Nada de migrar, deployar ni tocar borradores de Javier sin su OK.
No uses Creatomate.
```

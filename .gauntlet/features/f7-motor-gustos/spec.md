# F7 — Motor de gustos · SPEC (borrador)

> Pedido de Javier (29-09): "un motor que por las métricas empiece a seleccionar la música y las
> imágenes en base a lo que más les gusta a los clientes según las interacciones de Meta (likes y
> visualizaciones), que me vaya sugiriendo el tipo de contenido y que al mismo tiempo seleccione
> el más acorde".

**En una frase:** aprende de cada publicación qué rasgos (música, tipo de imagen, formato,
plantilla) le gustan al público de cada marca, y con eso (1) **elige** la música y la imagen de
cada pieza, (2) **sugiere** qué contenido hacer y qué material pedir, y (3) **explica** cada
elección. Javier sigue aprobando todo.

## Punto de partida (relevado en el código, 29-09)

- **Música:** sin tabla ni ficha. Son archivos sueltos en `cos-media/music/<slug>/` y se elige
  **al azar** (`post:draft` handlers.ts:324, `post:redo` :712, `holiday:stories` :896). Queda
  registrada en `cos_posts.music_key` (la ruta, entra en el hash de aprobación).
- **Imagen:** 1 asset por subida, sin ranking. La única selección automática son las historias
  de feriado (mejor `quality_score`, handlers.ts:855).
- **Rasgos de imagen hoy:** `cos_assets.ai_json` → category, products[], topics[], mood[],
  quality_score, commercial_value, suggested_formats[].
- **Métricas:** `cos_media` + `cos_media_metrics` (fotos en el tiempo con `age_hours`), 3.049
  publicaciones de las 6 cuentas. Vínculos: `cos_media.post_id` → `cos_posts` (lo de Content OS)
  y `cos_assets.origin_media_id` → `cos_media` (lo importado del IG viejo).
- **Motor de horarios** (`shared/cos/timing.ts`): rendimiento vs su época ±60 días + contracción
  bayesiana por franja. **El motor de gustos se monta encima; no lo reinventa.**
- A favor: como la música hoy sale al azar, cada post con música es un experimento limpio. Esa
  señal no se pierde porque `music_key` ya se guarda.

## La realidad que manda

1. **La música de Instagram no está en la API.** Ni la biblioteca de IG ni los audios en
   tendencia: la música va quemada en el archivo (Pixabay). El motor aprende y elige **dentro de
   nuestra biblioteca**. Un audio en tendencia solo puede aparecer como sugerencia para usarlo a
   mano.
2. **Las fotos del feed de IG no llevan música** (la API no lo permite). La señal de música sale
   de reels, historias y videos de FB.
3. **Lo publicado antes de Content OS no dice qué música tenía.** Sirve para aprender de
   imágenes y tipos de contenido, no de música. La música aprende desde que exista su ficha.
4. **Poco volumen.** Aprender tema por tema llevaría meses: se aprende por **rasgos** que
   comparten muchos posts (género, energía, ritmo · plano, protagonista, plato). Un tema nuevo
   hereda lo que ya se sabe de sus rasgos.
5. **Lo que no es contenido ensucia la señal:** hora, formato, crecimiento de la cuenta, pauta,
   feriados, clima. El motor mide el contenido **descontando lo que ya explica el motor de
   horarios**.
6. **Historias: 24 h de métricas** (ya resuelto por `metrics:sync`).
7. **Pauta:** un post promocionado con Ads infla el alcance y no puede enseñar nada. Se excluye
   (verificar contra la API si se puede detectar; si no, marca manual o cruce con Meta Ads).

## Qué es "gustar" (la puntuación de cada post)

Se mide a **edad fija** para que todo sea comparable (48 h feed/reel/carrusel; valor final en
historias), tomada de `cos_media_metrics`. Todo relativo: 1 = como siempre, 1,3 = +30 %.

| Componente | Cómo | Formatos |
|---|---|---|
| Vistas / alcance | views (reel, historia) o reach (foto) vs lo esperado para su época, formato y franja | todos |
| Interacción ponderada | (likes×1 + comentarios×2 + guardados×3 + compartidos×3) / alcance | feed, reel, carrusel |
| Retención | `ig_reels_avg_watch_time` / duración del reel | reel |
| Historia | alcance + respuestas − salidas (`navigation`) | historia |

**Decisión de Javier (30-09): entran TODAS las métricas que Meta entrega**, no solo likes y
vistas. Además de las de la tabla: seguidores ganados (`follows`), visitas al perfil
(`profile_visits`), tiempo total visto de reels y clics de FB (`post_clicks`). Cada una se
guarda como su propio lift (vs lo esperado para su época, formato y franja), así se puede
mirar el motor desde cualquiera y cambiar el objetivo sin rehacer nada.

Puntaje general = combinación de los componentes (media geométrica ponderada de los lifts).
Pesos editables por marca; arranca 50 % vistas / 50 % interacción, más la retención en reels.
**Más adelante (Fase 3):** clics del link `/r/` y pedidos atribuidos → "lo que vende", no solo
"lo que gusta".

### Objetivos (el mismo motor, distintos pesos)

| Objetivo | Pesa más | Para qué |
|---|---|---|
| **Gusta** (por defecto) | vistas + interacción + retención | elegir música e imagen |
| **Crece** | seguidores ganados + visitas al perfil | pauta de reconocimiento/seguidores |
| **Conversa** | comentarios + respuestas de historia + compartidos | pauta de interacción / «Comentá y te escribo» |
| **Vende** (Fase 3) | clics `/r/` + pedidos atribuidos | pauta de ventas |

## Candidatos a pautar (pedido de Javier, 30-09)

> "Así luego podemos decidir a cuáles pujar con dinero mediante ads pagas."

- Lista **«Para pautar»** por marca en la pestaña Gustos: publicaciones orgánicas de los
  últimos 14 días que rindieron claramente por encima de lo esperado **en su primeras 48 h**
  (evidencia real de que el contenido funciona, antes de poner plata).
- Cada candidato dice **para qué objetivo** conviene (Crece / Conversa / Vende) según qué
  métricas lo destacan, el lift con su confianza y **por qué** (qué rasgos tiene).
- Filtros: no sugiere piezas con promos vencidas (cruza con Datos vigentes), ni historias
  (duran 24 h), ni lo que ya está pautado.
- **Solo sugiere: no gasta plata.** Pautar lo decide Javier en Meta Ads. Más adelante se puede
  conectar con `meta-ads-mcp` para crear la campaña en borrador con un clic (fuera de F7).
- Cuando algo se pauta, **deja de enseñarle al motor orgánico** (el alcance pago lo infla) y
  pasa a medirse aparte: «orgánico vs pautado» para ver si el motor elige bien qué pautar.

## Qué aprende: los rasgos

Vocabulario **cerrado** por rasgo (lista fija), así "cenital" y "vista desde arriba" cuentan como
lo mismo.

- **Música** (tabla nueva `cos_music_tracks`, un tema = una fila con id estable):
  - automático en el worker (ffprobe/ffmpeg): duración, BPM, energía;
  - a mano con chips al subir (≈2 min para los 20 temas actuales): género (house, jazz, lounge,
    lo-fi, urbano, oriental…), mood (relajado, arriba, elegante, divertido), con voz / instrumental.
- **Imagen / video** (se suma al clasificador y se re-clasifica lo importado):
  - ya existen: categoría, productos, temas, mood, calidad, valor comercial;
  - nuevos: plano (primer plano, cenital, medio, ambiente) · protagonista (producto, manos/proceso,
    persona, local, placa) · acción (vapor, corte, armado, salsa cayendo, nada) · luz (cálida/fría,
    clara/oscura) · fondo (limpio/cargado) · en video: ritmo de cortes (ya existe `sceneCuts` de
    `ref:analyze`) y duración.
- **Pieza:** formato, plantilla (banda/etiqueta/firma/none), con frase o no, clima, feriado, con
  música o no.

## Cómo aprende (motor puro `shared/cos/taste.ts`, con tests)

1. **Residuo de contenido:** lift del post (`timing.ts`) ÷ lo que explica su franja día×hora
   (`slotModel`) → cuánto rindió por lo que *era*, no por *cuándo* salió.
2. **Efecto por rasgo** (por marca y formato): promedio del residuo (en log) de los posts con ese
   rasgo, con **contracción bayesiana** hacia "como siempre" (igual que en horarios: un rasgo con
   2 posts no manda) + incertidumbre → "+25 % ± 10 · 14 posts · confianza media".
3. **Separar rasgos que van juntos** (cuando haya ≥ ~150 posts de la marca en ese formato):
   regresión con contracción (ridge) sobre todos los rasgos a la vez, para no confundir "el jazz
   rinde" con "los reels con jazz eran justo los de sushi cenital". Hasta entonces se muestra el
   efecto simple con esa advertencia.
4. **Desgaste:** un tema o un tipo de imagen repetido pierde efecto; se penaliza lo usado en los
   últimos N posts de la marca.
5. **Recalcula a diario** (job `taste:learn`, dedupe por día) y guarda una foto del modelo
   (`cos_taste_models`): se puede ver cómo cambia y explicar cada elección con el modelo que la
   tomó.

## Cómo elige ("que seleccione el más acorde")

- **Primero el filtro duro:** brandbook y reglas de la marca, consentimiento, calidad mínima,
  duración compatible. El motor **nunca** elige fuera de lo que la marca permite.
- **Después elige explorando** (muestreo de Thompson): por cada candidato se sortea un valor
  dentro de lo que el motor cree (efecto ± incertidumbre) y gana el mayor. En la práctica: ~70 %
  sale lo que viene funcionando y ~30 % se prueba algo con poca data. Sin exploración el motor se
  encierra en lo primero que funcionó.
- Tope de exploración configurable (**30 %, decisión de Javier 30-09: aprender rápido**) y
  **cero exploración** en feriados, campañas y fechas clave. Cuando un rasgo pasa a confianza
  alta, la exploración sobre él baja sola.
- **Dónde elige:**
  - Música: `post:draft`, `holiday:stories` y `post:redo` ("otra música" = la siguiente mejor).
    Reemplaza los `Math.random()`.
  - Imagen: portada / primera del carrusel / cuál va a la historia cuando hay varias; historias
    de feriado y relleno automático desde el Archivo (hoy solo `quality_score`); sugerencias de
    reciclar material del Archivo con rasgos ganadores.
- **Cada elección guarda su porqué** (`cos_posts.pick_json`: candidatos, puntajes, aprovechar o
  probar, versión del modelo). En Aprobaciones: chip «🎵 Piano jazz · elegida por el motor
  (+18 % en reels)» o «🧪 Probando: tema nuevo». Si Javier la cambia, se guarda: es una señal de
  gusto *de marca* que el motor aprende a respetar.

## Qué sugiere ("que me vaya sugiriendo")

- **Pestaña Gustos** en Métricas, por marca: qué rasgos suben o bajan el rendimiento (barras ±
  incertidumbre, "poca data" cuando corresponde), música top y gastada, qué cambió este mes.
- **Plan de la semana** (lunes, job `taste:suggest`): 3-5 sugerencias concretas por marca
  («2 reels de armado con vapor + música urbana, jueves 20 h»), qué evitar, qué conviene probar.
- **Qué material pedir:** lista de tomas para los empleados («10 s del armado de onigiri con
  vapor, de cerca»). Con F3 prendida, llega a la PWA de Turnos.
- **Qué música bajar:** «Bijutsukan: el piano jazz rinde y el lounge electrónico no → bajá 5 de
  piano jazz de Pixabay; estos 3 ya se gastaron».
- Cada sugerencia se marca útil / no útil → el motor aprende qué sugerencias le sirven a Javier.

## Barandas

- **Nada se publica solo:** todo pasa por Aprobaciones. La música ya está en el hash de
  aprobación: cambiarla devuelve la pieza a aprobación.
- **El brandbook manda sobre las métricas.**
- **No afirma sin evidencia:** confianza alta/media/baja visible; "todavía poca data" antes que
  inventar.
- **La IA redacta, no calcula:** los números salen del motor puro (con tests). El prompt de
  sugerencias recibe la tabla de efectos y tiene prohibido inventar cifras.
- No aprenden: posts simulados, borrados ni pautados.
- **Costo IA:** re-clasificar lo importado ≈ USD 15 una sola vez (Haiku, ~3.000 × 0,005); las
  sugerencias semanales, centavos.

## Datos (migración 0018, propuesta)

```text
cos_music_tracks   id · brand_id · storage_key UNIQUE · title · duration_s · bpm · energy
                   · genre · mood text[] · vocals · source_url · license · active · created_at
                   (backfill desde los archivos de music/<slug>/)
cos_posts          + music_track_id (FK, backfill desde music_key) · pick_json
cos_assets         + traits jsonb · traits_version
cos_taste_models   brand_id · format · computed_at · n · model_json
cos_suggestions    id · brand_id · week · kind (contenido|material|musica) · items_json · feedback
```
RLS igual que el resto: lectura para `cos_members`, escritura solo por el servidor/worker.

## Entregas

| # | Qué | Modelo |
|---|---|---|
| **M0** | Fichas y registro: tabla de temas + ficha (chips + BPM/energía automáticos), rasgos nuevos en el clasificador, re-clasificar lo importado, vincular post ↔ tema. *Sin ficha no hay qué aprender: la música empieza a contar desde acá.* | Opus (migración) + Sonnet (chips) |
| **M1** | Motor que aprende (`taste.ts` + `taste:learn`) y pestaña Gustos, **solo lectura**. Ver lo que aprende antes de dejarlo elegir. | Opus (estadística) + Sonnet (pantalla) |
| **M2** | Selección automática de música e imagen con exploración + porqué en Aprobaciones. Toca draft/redo/render. | Opus |
| **M3** | Sugerencias: plan de la semana, material a pedir, música a bajar, **candidatos a pautar**. | Sonnet (la lógica de candidatos: Opus) |
| **M4** | (con Fase 3) Optimizar por ventas: clics `/r/` + pedidos atribuidos. | Opus |

Check del plan antes de M0 y auditoría al cerrar M2: **Fable**.

**Cuándo empieza a servir:** imágenes y formatos desde M1, con el histórico ya clasificado.
Música: ~6-8 semanas de publicaciones con ficha para decir algo con confianza media; hasta
entonces elige parecido a hoy (explorando), pero ordenado y midiendo.

## Aceptación

- Tests del motor: el residuo descuenta la franja · contracción con pocos datos · un tema nuevo
  hereda de sus rasgos · desgaste · Thompson respeta el tope de exploración y los filtros de
  marca · nunca elige música de otra marca · sin datos → "poca data".
- **Backtest con el histórico** (entrena hasta el mes X, evalúa el X+1): si el motor no predice
  mejor que "la mediana de siempre", **no se lo deja elegir imágenes**.
- Cada pieza elegida muestra su porqué en Aprobaciones (compu y celular).
- gauntlet verde + críticos Data y Domain (¿tiene sentido estadístico?) sin P0/P1 +
  gauntlet:prod verde.

## Decisiones de Javier (30-09)

1. **Gustar = todas las métricas** que genere Meta, con objetivos separados → sirve también para
   decidir qué pautar (sección «Candidatos a pautar»).
2. **Autonomía: el motor elige y Javier aprueba.** Si la cambia, el cambio también enseña.
3. **Exploración 30 %** (aprender rápido).
4. **Ficha de música: chips a mano + automático** (BPM, energía, duración).

## Ajustes de diseño en M0 (30-09, al construir)
- **Rasgos también en `cos_media`**, no solo en `cos_assets`: en producción hay 56 assets y
  3.050 publicaciones medidas. Sin rasgos en lo publicado, M1 no tendría de dónde aprender.
- **Miniaturas faltantes:** solo 670 de 3.050 publicaciones tenían miniatura (el recolector solo
  guarda la de lo que lista en cada vuelta). El backfill le pide a Meta una URL fresca (lectura),
  máximo 10 por tanda para no pisar la medición de métricas.
- **`music_track_id` lo completa la base** (trigger desde `music_key`), en vez de escribirlo en
  post:draft, post:redo, holiday:stories y Aprobaciones: una sola fuente, ningún camino se olvida.
- **Un tema que se saca de la biblioteca no se borra** (`active = false`): los posts que lo usaron
  siguen enseñando.
- **Costo real del backfill:** Haiku da USD 0,0012 por imagen (medido con 4 miniaturas reales) →
  ≈ USD 4-5 para todo el histórico, no 15. El tope queda en USD 15 (`cos_settings.traits_backfill_max_usd`).
- **BPM:** calibrado con los 20 temas reales de la biblioteca (todos entre 115 y 136). Las
  publicaciones viejas no tienen ritmo de edición (de lo publicado solo hay una imagen).

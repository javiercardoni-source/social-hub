# Hallazgos

| # | Feature | Sev | Hallazgo | Verificado | Estado |
|---|---|---|---|---|---|
| 1 | F1 | P1 | Sesgo por crecimiento: lift contra mediana anual | Sí (real) | Corregido: mediana de su época ±60 días + test |
| 2 | F1 | P1→✗ | "Fallback mezcla formatos de escalas distintas" | No: lifts() ya normaliza por formato | Descartado (falso positivo) |
| 3 | F1 | P1→P2 | Chips de horario con confianza baja se pueden usar sin aviso | Sí | Corregido: leyenda "poca data" visible |
| 4 | F1 | P2 | Seguidores sumados de varias cuentas con etiqueta singular | Sí | Corregido: "(N cuentas)" |
| 5 | F1 | P2→✗ | "perfValue mezcla alcance IG y vistas FB" | No: cada cuenta se compara consigo misma | Descartado |
| 6 | F1 | P1→P2 | Paginación: `next` sin `cursors.after` marcaría el histórico como terminado | Sí (borde; el escenario de "falla a mitad pierde datos" es falso) | Corregido: nextCursor() tira error |
| 7 | F1 | P1→P2 | Dos corridas de la misma cuenta a la vez (reloj + continuación) | Sí (gasta llamadas, datos idempotentes) | Corregido: guarda de corrida única |
| 8 | F1 | P2 | age_hours enviado como texto | Sí | Corregido |
| 9 | F1 | P2→✗ | "Vinculación post_id sin filtrar marca" | No: la cuenta pertenece a una sola marca | Descartado |
| 10 | F1 | P3→✗ | "onConflict sobre columna generada podría no deduplicar" | Probado contra la base real: 2 upserts misma hora = 1 fila | Descartado |
| 11 | F1 | P1 | (builder) Reloj de métricas re-encolaba cada 15 min | Sí | Corregido antes de críticos |
| 12 | F1 | P2 | (builder) FB devolvía alcance 0 con vistas reales | Sí | Corregido |
| 13 | QA visual | P0 | Se podía aprobar con la pieza a medio armar → se publicaba una versión no vista | Sí | Corregido: aprobarPost exige render_qa |
| 14 | QA visual | P1→P2 | Se puede aprobar una pieza que la IA marcó "tapa algo" | Sí (decisión de Javier) | Corregido: confirmación explícita |
| 15 | QA visual | P0→✗ | "Hash '' vs renderKey 'bottom'" | No: layout null = abajo siempre; clave de archivo ≠ contenido | Descartado |
| 16 | QA visual | P2→✗ | "Posts aprobados antes de 0008 quedan con hash viejo" | Verificado: no había ninguno | Descartado |
| 17 | QA visual | P1 | (builder) Reemplazo de sección borró 3 handlers | Sí (lo detectó el typecheck) | Restaurado + diff contra HEAD |

## Base de fotos (Drive por tandas) — 29-09-2026
- **18 · P1 REAL (arreglado):** `archive:import-drive-file` validaba `file_id` con `idFrom` (formato UUID); los ids de Drive no son UUID → no se habría importado nada. Nuevo `esIdDrive` (shared/cos/base-fotos.ts) + test.
- **19 · P2 REAL (arreglado):** `listTree` cortaba el recorrido al llegar a 20.000 archivos y salteaba carpetas en silencio. Ahora recorre todo y, pasado un tope de 100.000, falla con un mensaje claro.
- **20 · FALSO POSITIVO:** "descarga antes de chequear duplicado": el chequeo ya estaba antes de la descarga.
- **21 · Descartado:** paginación de ya-traídos de a 1000: lecturas livianas, sin impacto.

## Motores visuales + regla del clima — 29-09-2026
- **22 · P1→P2 REAL (arreglado):** un borrador con clima rechazado bloqueaba el clima del día. Ahora no cuentan REJECTED/CANCELLED ni borrados. (El crítico proponía contar solo PUBLISHED: descartado, una historia aprobada para más tarde tiene que contar.)
- **23 · P2 REAL (arreglado):** PNG con alto 0 daba aspect infinito → error claro.
- **24 · FALSO POSITIVO:** "ventana de 20 h en UTC": es una duración, la zona horaria no influye.
- **25 · Descartado:** caché de tipografías/logo sin límite (un archivo por subida, KB); carrera de dos tipografías simultáneas (el índice único la frena con mensaje); "rearmar contradice congelar lo aprobado" (solo toca PENDING_APPROVAL).

## F7 Motor de gustos · M0 (fichas y registro) — 30-09-2026
Críticos: Data, Integration, UX (subagentes independientes). Sin P0/P1 abiertos.
- **26 · P1 REAL (arreglado, lo encontré antes de los críticos):** graphGet envuelve los errores permanentes de Meta en PermanentError; el backfill los trataba como error del trabajo → un post borrado en Meta mataba todo el backfill. Ahora `clasificarError`: token → frena; límite → pausa 30 min; error del elemento → se anota en traits_error y sigue.
- **27 · P1 REAL (arreglado, UX):** si ffmpeg fallaba con un tema, music:analyze agotaba reintentos sin anotar nada → "midiendo" y auto-refresco para siempre. Ahora anota analysis_error y corta (PermanentError); el auto-refresco de Motores se apaga a los 10 min.
- **28 · P2 REAL (arreglado):** el tope de gasto del backfill se chequeaba solo al armar la tanda (con costo estimado). Ahora también con el gasto real antes de cada elemento.
- **29 · P3 (arreglado):** sceneCuts fallaba en silencio en classifyAsset → ahora queda en el log.
- **30 · FALSO POSITIVO:** "loop sin escape" en media sin miniatura: cada tanda usa 10 llamadas nuevas a Meta en posts distintos; avanza de a 10.
- **31 · FALSO POSITIVO:** "toques rápidos en chips se pisan": `disabled={pending}` bloquea el segundo toque.
- **32 · FALSO POSITIVO:** "BPM sin pulso claro mientras mide": en estado midiendo se muestra "Midiendo…".
- **33 · Descartado/P3:** carreras de upsert entre web/script/sync (dedupe por clave, sin IA); rasgos duplicados en ai_json (bytes); analysis_error no se reintenta solo (a propósito; re-subir lo resetea); pantalla larga con 20 temas (compactar en M1); storage_key sin constraint de inmutable (nadie lo actualiza).

## F9 Video primero (motor de reels) — 30-09-2026
Críticos: worker/datos/publicación y UX (subagentes independientes). Sin P0/P1 abiertos.
- **34 · P1 REAL (arreglado, visto en producción con el backfill de F7):** Haiku devolvió un rasgo fuera de la lista pese al enum del schema; la validación estricta hacía fallar la imagen entera y, con el mismo schema, habría hecho fallar la clasificación completa de un asset nuevo. Ahora el schema acepta texto (opciones en la descripción) y todo pasa por `normalizarRasgos` (lo raro queda vacío). Lo mismo en el guion del reel (movimiento/transición los corrige `normalizarGuion`).
- **35 · P2 REAL (arreglado):** música más corta que el reel dejaba el final mudo → la música va en bucle (`-stream_loop -1`), probado con un tema de 3 s.
- **36 · P2 REAL (arreglado):** «Armar reel» aceptaba piezas READY todavía sin analizar → exige `quality_score`.
- **37 · P2 (arreglado):** texto largo en «Por qué estas tomas» (break-words) y placeholder del gancho.
- **38 · Mejora propia (sin crítico):** el guion no entra en el hash → trigger en 0019 que lo congela fuera de DRAFT/PENDING_APPROVAL; precio/pie del cierre congelados al armar; clave del video por contenido (el reel, la historia y FB comparten archivo).
- **39 · FALSO POSITIVO / preexistente:** "HEIC sin convertir" (las fotos ya pasan por el mismo ffmpeg del worker); "se pierde el gancho con F5 / Rehacer descarta cambios" (así funciona toda Aprobaciones desde antes; rehacer reemplaza a propósito); "casilla de 24 px" (toda la miniatura es el botón); render doble en paralelo (mitigado por la clave por contenido).
- **40 · P0 REAL (arreglado, visto en la prueba en el servidor):** la unión final del reel murió por memoria (SIGKILL) con el límite de 768 MB del worker: 8 entradas 1080×1920, decodificadores con hilos por cuadro y x264 "medium". En la Mac no aparecía. Ahora: 1 hilo por decodificador y filtro, x264 veryfast con lookahead 10 → 65 s por reel y pico ~690 MB; y el worker pasó a 1,5 GB en el compose del servidor (backup `docker-compose.bridge.yml.bak-20260930`; el host tiene 5,4 GB libres).
- **41 · P1 REAL (arreglado, visto en producción):** un deploy (SIGTERM) cortaba la cadena del backfill de rasgos: el trabajo terminaba "hecho" sin encolar la siguiente tanda. La continuación ahora se encola también durante el apagado.
- **42 · P2 REAL (arreglado, visto en el reel de producción):** texto blanco sobre fondos claros (placa beige de FasutoFudo) casi no se leía → contorno oscuro corto + sombra (REEL_VERSION 2, rearma solo).

## F8 Agenda automática — 30-09-2026
Críticos: datos/aprobación, dominio/integración, UX (subagentes independientes). Sin P0 abiertos (el de datos confirmó que no hay forma de publicar algo no aprobado).
- **43 · P1 REAL (arreglado, propio):** carrera entre la agenda (worker, cada hora) y «Aprobar»: se podía sellar una hora distinta de la vista. Ahora la pantalla manda la hora vista y el sellado es condicional (`.eq("scheduled_at", vista)`); si cambió, se pide recargar.
- **44 · P1 REAL (arreglado, propio):** el reloj vence lo PENDING con hora pasada → la agenda nunca deja un borrador a menos de 2 h (y corre cada hora).
- **45 · P2 REAL (arreglado):** la evidencia por hora sumaba la de otras cuentas y la exploración casi no ocurría (justo en Bijutsukan, que siempre publicó a las 20). Ahora la evidencia es solo la propia; test.
- **46 · P2 REAL (arreglado):** el porqué no decía cuando había poca evidencia → «poca data».
- **47 · P1 UX (arreglado):** «Otro horario 🔒» confundía → «Elegir a mano 🔒»; el texto decía «dentro del día» y la ventana es ese día y el siguiente; inputs de horario a 16 px (iPhone hace zoom con menos), llaves más grandes, estado vacío y aviso al apagar la agenda, aria-label.
- **48 · Defensivo (arreglado):** los updates del plan filtran también por marca.
- **49 · FALSO POSITIVO / a propósito:** «post en PUBLISHING queda trabado por el re-sellado» (el guardián no compara el sello al pasar a PUBLISHED); «filas repetidas en cos_slot_models» (es una foto por corrida, se lee la última); «rechazados no cuentan en la regla del clima» (regla vigente; las historias de clima sí cuentan las rechazadas para no repetir); «se habla de ventana en la pantalla» (no aparece).
- **Real, verificado en producción (solo lectura):** Open-Meteo archivo y pronóstico por hora OK; motor con el historial real elige franjas coherentes; lectura de horarios de las 3 webs: Sensaciones todos los días 16:30-22:30, Bijutsukan lun-sáb, FasutoFudo mar-sáb.

## F7 M1 (el motor aprende + pestaña Gustos) y M2 (el motor elige) — 30-09-2026
Críticos M1: dominio/datos y UX. Sin P0/P1 reales abiertos. (Check de M2 con Fable: queda para cuando Javier cambie de modelo; se corrió un crítico independiente.)
- **50 · Backtest (propio, verificado con datos reales):** la primera versión comparaba mal (el modelo partía del promedio, que se corre por los virales, y sumaba efectos no claros). Ahora los dos parten de la mediana del entrenamiento y el modelo usa solo efectos claros, como el motor. Resultado real: gana SOLO en reels de Sensaciones (−7 % de error, 43 casos) → M2 elige imágenes solo ahí; música en todas.
- **51 · P2 UX (arreglado):** nombres de rasgos cortados en celular, textos de 10 px, aviso «va junto con» poco visible, punto gris con poco contraste.
- **52 · FALSO POSITIVO:** «el color es la única señal» (los porcentajes llevan +/−); «simulados entrenan al motor» (nunca llegan a cos_media; igual se filtran); «cos_taste_models sin upsert» (una foto por día a propósito).
- **53 · Aceptado y documentado:** posts de más de 120 días usan su último valor (no 48 h): escala levemente distinta, afecta a la normalización, no al orden.

## F7 M2 (el motor elige) — 30-09-2026
Crítico independiente: auditoría sin escribir código. Sin P0. Tests PASS (264 tests, 25 archivos).
- **54 · P1 (performance) — ARREGLADO:** temasParaReel llama a candidatosMusica 2 veces (línea 66 + 68 de eleccion.ts), en lugar de 1. Impacto bajo: solo redo de reels (no frecuente) y candidatosMusica es rápida. Sugerencia: retornar candidatos desde elegirMusica o cachear.
- **55 · P2 (fragilidad) — ARREGLADO:** pick_json.final no se setea en post:draft (handlers.ts:364), solo en redo de reels (línea 519). La check en Aprobaciones (página.tsx:173) depende del fallback a elegido. Funciona hoy; es frágil si cambia la estructura de pick_json. Impacto: cosmético (no muestra "🎵 elegida por el motor" si falla). Sugerencia: setear final en post:draft también.
- **56 · P2 (inconsistencia):** fondoHistoria (agenda.ts:519-527) usa hash custom para elegir foto cuando elegirImagen retorna null (sin backtest). Otros lugares usan elegir() de pick.ts. Es determinístico y estable; redundancia solo de patrones. Impacto: ninguno operativo.
- **OK:** Nunca elige música de otra marca · temas sin ficha neutrales · sin modelo = neutral · imágenes solo donde backtest gana · override registrado · preferencia acotada ±15% · semillas estables (draft:asset, reel:origen, redo:job:post, campaign) · idempotencia post:draft · redo no repite · hash intacto (music_key sí, music_track_id no).

## F7 M3 (sugerencias y candidatos a pautar) — 30-09-2026
Crítico independiente (dominio + UX): PASS, sin P0/P1. Confirmado: ninguna llamada a la API de Ads.
- **57 · P2 aceptado:** precios escritos como «$31,9k» no se reconocen como precio (el caption así no se descarta). Poco frecuente; queda anotado.
- **58 · P3 aceptado:** el validador de cifras no detecta «el doble» escrito en palabras (sí «200 %»).
- **59 · P3:** listas con sangría en celular algo apretadas.

## F12 App de aprobación en el celular — 07-10-2026
Crítico: repaso directo en Playwright con perfil iPhone 15, contra producción, con sesión real (social@kitchco.ar). Sin subagente aparte (ver nota en status.md); se actuó como UX Critic de celular sobre la cola real (219 piezas pendientes), solo lectura salvo el panel de rechazo (abierto y cancelado, nunca confirmado — verificado contra la base que ningún post cambió de estado).
- **60 · P2 UX REAL (arreglado):** el botón flotante de reportar errores (🐛, global en el layout raíz) quedaba encima del texto de la tarjeta y justo en la esquina donde termina el gesto de aprobar — con el pulgar podía interceptar el swipe. Se oculta en `/app` (ya tenía el mismo mecanismo para `/login`).
- **61 · P1 UX REAL (arreglado):** con una marca de nombre largo (p. ej. "Sensaciones de Oriente"), la franja de chips se comía todo el ancho y el contador "N / M" + la campana de avisos quedaban fuera de pantalla, sin forma de scrollear hasta ellos de un vistazo. Ahora solo los chips de marca se deslizan en su propia franja; contador y campana quedan fijos y siempre visibles.
- **62 · P1 REAL (arreglado, propio):** `onCerrar` del panel (motivo de rechazo / elegir hora) estaba atado a `resetDrag`, que solo reacomoda la posición del arrastre y nunca cierra el panel (`sheet` seguía abierto). Tocar «Cancelar» o el fondo no hacía nada visible: sin recargar, no había forma de salir del panel. Encontrado simulando el gesto de rechazar y cancelando; se agregó `cerrarSheet()` (cierra + reacomoda) y se usa en los dos paneles.
- **Verificado en producción (solo lectura, sesión real):** login vuelve a `/app` (no a `/inicio`) después de loguearse desde la cola; el manifest (`/app/manifest.webmanifest`) responde 200 con `start_url: /app`; cero errores de consola en las 3 corridas; después de abrir el panel de rechazo y cancelar dos veces (por gesto y por botón ✕), el post de prueba siguió `PENDING_APPROVAL` en la base.
- **Pendiente de probar con Javier (no se puede simular de forma confiable):** el permiso de notificaciones push en un iPhone real (Playwright/Chromium no replica el diálogo nativo de iOS ni el service worker en segundo plano de Safari); el desbloqueo de audio con "Empezar" en Safari real (el truco de que un solo play() con gesto habilita los siguientes está documentado como válido en WebKit, pero no hay forma de confirmarlo fuera de un iPhone de verdad); aprobar de verdad (deslizar a la derecha) no se probó en vivo a propósito, para no tocar piezas reales sin que Javier lo pida.

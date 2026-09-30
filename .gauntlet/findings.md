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

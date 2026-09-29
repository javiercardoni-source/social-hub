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

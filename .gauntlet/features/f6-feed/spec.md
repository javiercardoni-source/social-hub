# F6 · Vista del feed + estilo de grilla (pedido 29-09-2026)

## Qué
- Sección **Feed** por marca: la grilla del perfil de Instagram (3 columnas, miniaturas 3:4 como el perfil actual) con lo publicado abajo y lo programado arriba, en el orden en que va a salir. Opción de sumar lo pendiente de aprobar.
- **Estilo de grilla**: regla por columna (izquierda / centro / derecha) = con texto · sin texto · libre. Cada pieza por salir se marca ✓ o ⚠ según la regla.
- **Análisis con IA**: mira la grilla (imagen) + rendimiento por formato y devuelve observaciones, un estilo sugerido (aplicable con un clic) y cambios de orden propuestos. No mueve nada solo.

## Reglas
- La columna de una pieza depende de cuántas salen después: se evalúa la grilla "cuando salga todo lo programado". El patrón se sostiene publicando de a 3 (se explica en pantalla).
- "Tiene texto" en lo nuestro = plantilla banda/etiqueta con frase; firma o sin plantilla = sin texto. En lo publicado lo dice la IA al analizar.
- Historias no van en la grilla.

## Criterio de aceptación
- Tests de orden, columnas y evaluación de reglas.
- La grilla se ve bien en compu y en iPhone (gauntlet:prod).
- El análisis corre en el worker, guarda el resultado y no toca posts.

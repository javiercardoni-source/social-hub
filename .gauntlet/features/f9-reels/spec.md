# F9 · Video primero: motor de reels (pedido 30-09-2026)

Decisión de Javier: "nos basamos siempre en video; foto en los post casi no se usa; tienen que tener una imagen primera pero con sonido y movimiento". Pruebas del 30-09 (Sensa15, Social.mp4, 5 fotos): nuestro motor (ffmpeg + satori) da lo mismo que Creatomate, en 1080×1920 y gratis → no se paga Creatomate.

## Etapa 1
- Motor de reels en el worker (worker/src/reel.ts): guion de la IA (tomas de videos con trim, fotos con Ken Burns, movimiento, transición, gancho, medio, cierre, música) + armado con ffmpeg + textos con el kit de la marca (tipografías/logo/sin firma).
- Guion guardado en el post (cos_posts.montaje); post:render arma el reel desde el guion: si Javier edita la frase o la música, se rearma.
- "Usar" (y la cocina) → reel en vez de foto fija: IG reel + IG historia + FB video. Post de foto fija: apagado por defecto (setting).
- Cierre de marca: título + recuadro; precio SOLO si hay combo con precio en Datos vigentes; pie SOLO con zonas cargadas. Nada inventado.
- Reglas de marca en el guion: nada de escasez inventada, bebida no protagonista, frescura no como promesa, sin caras bloqueadas.

## Etapa 2
- "Armar reel" con varias piezas (selección en Biblioteca/Archivo).
- Tapa: primer cuadro fuerte con el gancho; thumb_offset al publicar.

## Aceptación
- Tests del guion (normalización, línea de tiempo con transiciones, límites de trim).
- Un reel real armado en el worker (local) por marca, revisado a ojo.
- gauntlet + gauntlet:prod verdes.

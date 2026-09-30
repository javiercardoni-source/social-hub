# Decisiones

- 28-09: historias de Turnos: solo las que el empleado marca "para redes" (decisión de Javier).
- 28-09: material a cargar: lo publicado en IG + carpetas ADS del Mac + otra carpeta/Drive (falta la ruta).
- 28-09: orden: primero analytics (las métricas necesitan tiempo para acumularse).

## 30-09-2026 · F7 ↔ F9: quién elige la música de un reel
- Hasta que F7 M2 exponga su selector, **la música de los reels la elige el guion** (la IA, entre
  los temas de la biblioteca de la marca). Queda en `music_key` → `music_track_id` (F7 M0), así
  que F7 aprende igual de esos reels.
- Cuando exista el selector de F7: `planearReel()` recibe la lista ordenada por F7 y la IA elige
  entre las 3 primeras (HANDOFF F9 §6). El `pick_json` de F7 se completa en ese momento.
- «Otra música» al rehacer un reel: la IA elige entre los temas que no son el actual.

## 30-09-2026 · F9: el guion no entra en el hash, pero la base lo congela
- `cos_posts.montaje` no entra en el hash de aprobación (spec F9). Para que igual nunca se publique
  un reel distinto del que se vio, la migración 0019 impide cambiarlo fuera de DRAFT /
  PENDING_APPROVAL, y el precio y el pie del cierre se congelan en el guion al armar el borrador
  (si cambian los Datos vigentes, el reel aprobado no cambia).
- La clave del video es por contenido (`renders/reels/<marca>/<hash>.mp4`): el reel, la historia y
  el video de Facebook de una misma subida comparten archivo si son iguales (1 CPU en el server).

# Estado

| Feature | Estado | Notas |
|---|---|---|
| F1 Analytics + motor de horarios | **PASS** 28-09 | 3.049 publicaciones medidas (6 cuentas). Críticos: 2 (datos/integración, estadística/UX). Hallazgos 1-12. |
| QA visual de la pieza final | **PASS** 28-09 | La IA revisa posiciones; aprobar exige pieza revisada. Crítico: 1. Hallazgos 13-17. |
| F4 Contexto: feriados, fechas especiales, clima | **PASS** 28-09 | 35 feriados, 24 fechas, clima 7 días; IA con contexto; feriado = domingo. |
| F2 Carga del material existente (IG publicado, carpetas ADS, otra carpeta/Drive) | SPEC | falta la ruta de "otra carpeta/Drive" |
| F3 Historias de Turnos "para redes" → IA → aprobación | pendiente | Turnos tiene trabajo sin commitear en historias |
| F7 Motor de gustos (música + imágenes por métricas, sugerencias, candidatos a pautar) | **M0 PASS** 30-09 · en producción (0018) · backfill de rasgos corriendo | 0018 + music:sync/analyze + traits:backfill + chips en Motores. Críticos: 3. Hallazgos 26-33. Backfill de rasgos listo, NO corrido. Próximo: M1 |
| F8 Agenda automática (motor elige día+hora; aprende de Meta + feriados + clima; historias de clima; agente estratega) | SPEC · **EN PAUSA** | `features/f8-agenda/spec.md` · decisiones 30-09 cerradas · Javier suma más cosas antes de arrancar |
| F9 Video primero (motor de reels: cocina/Usar → reel + historia + FB video; Armar reel con varias; tapa) | **PASS** 30-09 · en producción (0019) · gauntlet:prod verde · falta la prueba de publicación con Javier | Reels reales armados en local por marca (Sensa video, Sensa 5 fotos, FF mascota, logo Biju). Críticos: 2. Hallazgos 34-39 |

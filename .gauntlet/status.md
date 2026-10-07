# Estado

| Feature | Estado | Notas |
|---|---|---|
| F1 Analytics + motor de horarios | **PASS** 28-09 | 3.049 publicaciones medidas (6 cuentas). Críticos: 2 (datos/integración, estadística/UX). Hallazgos 1-12. |
| QA visual de la pieza final | **PASS** 28-09 | La IA revisa posiciones; aprobar exige pieza revisada. Crítico: 1. Hallazgos 13-17. |
| F4 Contexto: feriados, fechas especiales, clima | **PASS** 28-09 | 35 feriados, 24 fechas, clima 7 días; IA con contexto; feriado = domingo. |
| F2 Carga del material existente (IG publicado, carpetas ADS, otra carpeta/Drive) | SPEC | falta la ruta de "otra carpeta/Drive" |
| F3 Historias de Turnos "para redes" → IA → aprobación | pendiente | Turnos tiene trabajo sin commitear en historias |
| F7 Motor de gustos (música + imágenes por métricas, sugerencias, candidatos a pautar) | **M0-M3 PASS** 30-09 · en producción (0018, 0021) | M0 fichas y rasgos (hallazgos 26-33) · M1 aprende + pestaña Gustos; backtest real: las imágenes solo ganan en reels de Sensaciones (50-53) · M2 elige música en todo e imágenes solo donde el backtest gana; los cambios de Javier cuentan como preferencia (54-56) · M3 sugerencias semanales + candidatos a pautar + «Ya la pauté»; un solo plan con la agenda (57-59). Check con Fable pendiente (cuando Javier cambie de modelo). M4 (ventas) espera la Fase 3 |
| F8 Agenda automática (motor elige día+hora; aprende de Meta + feriados + clima; historias de clima; agente estratega) | **PASS** 30-09 · en producción (0020) | Contexto de 3.050 publicaciones (121.800 h de clima), 13 modelos, horarios leídos de las 3 webs y confirmados, historias de clima andando. **Agenda automática APAGADA en las 3 marcas: la prende Javier en Marca → Agenda.** Hallazgos 43-49 |
| F9 Video primero (motor de reels: cocina/Usar → reel + historia + FB video; Armar reel con varias; tapa) | **PASS** 30-09 · en producción (0019) · gauntlet:prod verde · falta la prueba de publicación con Javier | Reels reales armados en local por marca (Sensa video, Sensa 5 fotos, FF mascota, logo Biju). Críticos: 2. Hallazgos 34-39 |
| F12 App de aprobación en el celular (`/app`, PWA, gesto tipo Tinder, avisos push) | **TEST** 07-10 · en producción | Plan en `features/f12-app-aprobar/spec.md`. E1-E4 implementadas y deployadas. Repaso en Playwright/iPhone contra prod (sin subagente aparte, ver nota abajo): 3 hallazgos reales, los 3 arreglados y verificados de nuevo (hallazgos 60-62). Falta: la prueba final de Javier en su iPhone de verdad (audio, push, aprobar deslizando) — eso es lo único que define el PASS del GOAL. |

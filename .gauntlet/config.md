# Gauntlet — configuración

- Protocolo: `GAUNTLET.md`.
- Builder: sesión principal de Claude Code.
- Críticos: subagentes independientes (Agent tool). Reciben la spec, los archivos y la consigna
  de romperlo; deben leer TODAS las migraciones antes de afirmar algo sobre la base. Reportan
  P0–P3 con archivo:línea y cómo reproducir.
- Verifier: re-corre `npm run gauntlet` y `npm run gauntlet:prod` y chequea P0/P1 cerrados.

## Router
| Área | Críticos |
|---|---|
| Worker / Meta / Drive / publicación | Integration Critic, Idempotency Critic |
| Base de datos / migraciones | Data Critic (RLS, hash de aprobación, transiciones) |
| Pantallas | UX Critic (celular incluido), Product Critic (¿sirve para el objetivo?) |
| IA (prompts, clasificación, copies) | Domain Critic (marca, no inventar, calidad) |
| Analytics / motor | Data Critic, Domain Critic (¿las recomendaciones tienen sentido estadístico?) |

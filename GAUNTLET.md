# GAUNTLET — Protocolo de desarrollo de Social Hub / Content OS

> Mismo protocolo que Traveller Coach y LIABLO, adaptado. Adoptado el 2026-09-28 a pedido de
> Javier: "minimizar al máximo la cantidad de errores y pruebas conmigo".

## Objetivo
Que Javier no sea el que encuentra los errores. Una feature no está terminada porque "anda en
mi máquina": tiene que sobrevivir una cadena explícita de validación, incluida producción.

## Estados
SPEC → DESIGN → IMPLEMENT → TEST → CRITIC → FIX → REGRESSION → VERIFY → PASS

## Reglas
1. **Independencia:** quien implementa no se aprueba. Los críticos son subagentes que no
   escribieron el código y tienen la consigna de romperlo.
2. **Todo hallazgo se verifica contra el código antes de corregirlo.** (28-09: los revisores
   dieron falsos positivos por leer solo la migración 0001. Los críticos deben leer TODAS las
   migraciones de `supabase/migrations/` antes de afirmar que una columna no existe.)
3. **Probar contra la realidad:** las integraciones (Meta, Drive, IA) se prueban con llamadas
   reales de solo lectura antes de dar por buena la spec. Nada que publique, borre o modifique
   datos de Javier sin su OK; las pruebas usan borradores propios que se borran al final.
4. **No se le entrega a Javier sin `npm run gauntlet` verde y `npm run gauntlet:prod` verde
   después del deploy.**

## Severidad
- **P0** bloqueante, seguridad, pérdida de datos, publicar algo no aprobado.
- **P1** fallo funcional grave.
- **P2** UX o consistencia importante.
- **P3** mejora no bloqueante.
No hay PASS con P0/P1 abiertos.

## Checklist universal
requisito cumplido · camino feliz · errores visibles (nunca tragados en silencio) · estados
vacíos · permisos (roles cos_members) · marca elegida respetada · celular · persistencia ·
idempotencia (reintentos sin duplicar) · seguridad (secretos, RLS) · observabilidad (logs del
worker, errores legibles) · tests · regresión.

## Comandos
- `npm run gauntlet` — typecheck (web + worker) + lint + tests (incluye la base en PGlite con
  todas las migraciones) + build.
- `npm run gauntlet:prod` — contra producción, sin modificar nada: salud, login, todas las
  pantallas en compu y en iPhone (sin errores de JS, sin páginas de error, sin desborde lateral).

## Artefactos
`.gauntlet/` → config.md · status.md · findings.md · decisions.md · regression.md · features/<feature>/

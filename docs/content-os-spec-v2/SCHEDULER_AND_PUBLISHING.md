# SCHEDULER & PUBLISHING

## MVP
Scheduler local persistente.

## Requisitos
- jobs persistentes;
- timezones;
- wake-up reconciliation;
- retries;
- idempotencia;
- token refresh;
- pause global;
- logs;
- estados.

## Dependencia de Drive
Antes de publicar:
1. resolver AssetVersion;
2. verificar drive_file_id;
3. descargar a cache si hace falta;
4. validar media;
5. publicar;
6. registrar remote_post_id;
7. limpiar cache opcionalmente.

## Reinicio
Al iniciar:
- detectar jobs vencidos;
- verificar si ya se publicaron;
- no duplicar;
- aplicar política MISSED_POST_POLICY.

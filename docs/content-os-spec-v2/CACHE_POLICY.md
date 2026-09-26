# CACHE POLICY

## Objetivo
La caché local debe ser descartable.

## Tipos
- originals temporales;
- proxies;
- previews;
- generated temporales.

## Reglas sugeridas
- previews pequeñas pueden persistir;
- originals temporales borrar luego de procesamiento;
- generated borrar luego de upload a Drive;
- tamaño máximo configurable;
- LRU cleanup;
- nunca borrar archivo maestro de Drive.

## Recovery
Si falta cache:
volver a descargar desde Drive.

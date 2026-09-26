# MEDIA PIPELINE

## Filosofía
Procesar localmente, almacenar resultado en Drive.

## Pipeline
1. Descargar original a cache.
2. Generar proxy si corresponde.
3. Ejecutar edición.
4. Exportar versión local temporal.
5. Subir versión a Drive.
6. Registrar AssetVersion.
7. Generar thumbnail/preview.
8. Opcionalmente limpiar archivo temporal.

## Capacidades
- trim;
- crop;
- resize;
- 9:16;
- 4:5;
- 1:1;
- text overlays;
- logo;
- subtitle;
- audio mix;
- normalization;
- concatenation;
- thumbnail;
- cover.

## Música
Solo usar:
- librería propia;
- audio autorizado;
- pistas con derechos compatibles;
- catálogos explícitamente habilitados por integración.

Guardar referencia de pista y licencia/origen.

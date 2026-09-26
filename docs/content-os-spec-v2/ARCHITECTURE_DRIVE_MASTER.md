# ARQUITECTURA — DRIVE MASTER

## Principio

Google Drive es la única fuente maestra de multimedia.

```text
                    +-----------------------------+
                    | Sistema de Conteo de Horas  |
                    | y Turnos                    |
                    +--------------+--------------+
                                   |
                                   v
                         +------------------+
                         |   Google Drive   |
                         |  MEDIA MASTER    |
                         +--------+---------+
                                  |
                     sync metadata / fetch on demand
                                  |
                                  v
+------------------------------------------------------------------+
|                         CONTENT OS LOCAL                         |
|                                                                  |
|  Desktop UI                                                     |
|      |                                                          |
|  Local Core                                                     |
|      |                                                          |
|  SQLite Operational State                                       |
|      |                                                          |
|  + AI Orchestrator                                              |
|  + Media Processor                                              |
|  + Approval Engine                                              |
|  + Scheduler                                                    |
|  + Social Publishers                                            |
|  + Backup                                                       |
|                                                                  |
|  Local Cache = temporal only                                    |
+------------------------------------------------------------------+
                                  |
                                  v
                    Instagram / Facebook / TikTok
```

## Regla clave
Content OS nunca debe depender de una ruta local permanente para un asset.

Debe depender de:
- drive_file_id;
- asset_id;
- version_id;
- checksum;
- metadata.

## Caché
El sistema puede usar:
- cache/originals
- cache/proxies
- cache/generated

Pero cada entrada debe ser descartable y reconstruible desde Drive.

## Limpieza
Configurable:
- limpiar caché al superar tamaño máximo;
- borrar temporales viejos;
- conservar previews pequeñas;
- nunca borrar archivos maestros de Drive automáticamente.

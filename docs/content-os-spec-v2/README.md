# Content OS — Developer Package v2

## Decisión arquitectónica principal

**Google Drive es el almacenamiento maestro de todo el material multimedia.**

Content OS NO debe depender de guardar permanentemente fotos y videos en la computadora local.

La aplicación local funciona como:
- centro de control;
- interfaz;
- motor de automatización;
- procesador temporal;
- scheduler local durante el MVP;
- caché temporal;
- base de datos operativa local.

Google Drive funciona como:
- fuente maestra de originales;
- almacenamiento de versiones generadas;
- almacenamiento de previews;
- almacenamiento de exports finales;
- respaldo multimedia;
- canal de ingreso desde empleados.

## Flujo general

Sistema de Conteo de Horas y Turnos
-> Google Drive
-> Content OS
-> clasificación IA
-> campaña
-> edición
-> preview
-> aprobación
-> programación
-> publicación
-> historial
-> backup

## MVP
El MVP corre localmente, pero todo el contenido multimedia vive en Drive.

A los 90 días desde la primera ejecución, el sistema debe avisar que es momento de evaluar migrar scheduler + publishing engine a cloud 24/7.

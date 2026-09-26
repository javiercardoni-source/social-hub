# MASTER DEVELOPER PROMPT — CONTENT OS v2

Actuá como Lead Engineer, Software Architect, AI Systems Engineer y Product Engineer del proyecto Content OS.

Antes de escribir código, leé todos los archivos Markdown de este repositorio.

## Decisión contractual

Google Drive es la fuente maestra de archivos multimedia.

La computadora local:
- NO debe almacenar permanentemente la librería completa;
- puede descargar archivos temporalmente;
- puede mantener previews pequeñas;
- puede usar caché controlada;
- puede mantener una base SQLite con metadata, estados, ids, calendario y auditoría;
- debe limpiar caché según política.

Google Drive:
- mantiene originales;
- mantiene versiones generadas;
- mantiene exports aprobados;
- mantiene previews cuando sea necesario;
- mantiene contenido recibido desde empleados.

## Objetivo

Construir una aplicación desktop local, moderna e intuitiva, capaz de:
- sincronizar contenido desde Drive;
- recibir material desde el Sistema de Conteo de Horas y Turnos;
- exigir descripción obligatoria por asset;
- clasificar contenido;
- generar campañas;
- editar fotos/videos;
- generar captions;
- adaptar publicaciones por Instagram, Facebook y TikTok;
- presentar previews;
- requerir aprobación;
- programar;
- publicar;
- reintentar errores;
- registrar auditoría;
- mantener versiones;
- hacer backup del estado;
- mostrar aviso cloud a los 90 días.

## No negociables

1. Drive = media master.
2. SQLite = operational state local.
3. GitHub privado = código/config/documentación.
4. Secretos fuera del repo.
5. No duplicar publicaciones.
6. No sobrescribir versiones.
7. No publicar sin aprobación en SAFE MODE.
8. Todos los assets deben tener descripción.
9. Cada integración social debe estar desacoplada.
10. El diseño debe permitir mover scheduler/publicación a cloud sin reescribir el core.

## Orden de trabajo

1. Leer documentación.
2. Crear IMPLEMENTATION_PLAN.md.
3. Crear TASKS.md.
4. Crear ADR inicial con decisiones.
5. Implementar storage abstraction.
6. Implementar Drive sync.
7. Implementar DB.
8. Implementar UI.
9. Implementar IA.
10. Implementar media pipeline.
11. Implementar approvals.
12. Implementar scheduler.
13. Implementar social adapters.
14. Implementar backups.
15. Implementar aviso día 90.
16. Tests end-to-end.

No declarar el proyecto terminado hasta demostrar el flujo completo.

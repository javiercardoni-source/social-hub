# DRIVE SYNC ENGINE

## Objetivo
Mantener SQLite sincronizado con Google Drive sin descargar toda la librería.

## Estrategia
1. Consultar cambios/metadatos.
2. Registrar assets nuevos.
3. Detectar cambios por modifiedTime + checksum.
4. Descargar solo cuando sea necesario.
5. Crear proxy/thumbnail local si hace falta.
6. Evitar duplicados.
7. Guardar estado de sync.

## Fetch on demand
Descargar original cuando:
- se necesite editar;
- se necesite generar preview;
- se necesite publicar;
- el usuario lo abra en tamaño completo.

## Upload de versiones
Toda versión generada debe subirse a Drive.

Luego:
- registrar drive_file_id;
- guardar metadata técnica;
- permitir borrar copia local.

## Offline
Si no hay internet:
- UI sigue funcionando con metadata local;
- publicaciones nuevas quedan bloqueadas;
- sincronización queda pendiente;
- mostrar estado offline.

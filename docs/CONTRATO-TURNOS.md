# Contrato Turnos ↔ Content OS (módulo «Enviar contenido»)

> Escrito el 2026-09-26. Detalla el §7 de `PLAN-CONTENT-OS.md`. Es la fuente de verdad de
> la integración: si Turnos o Content OS cambian algo de acá, se cambia primero este archivo.
>
> **Por qué existe:** al arrancar Content OS, Turnos tenía **trabajo en curso sin commitear**
> de otras sesiones (editor de Historias, apodo, balance: 45 archivos, migraciones 0139-0141).
> Para no mezclarse, el lado de Turnos se implementa cuando ese trabajo esté commiteado,
> siguiendo este contrato al pie de la letra.

## Frontera

- **Turnos** solo sabe «recibí esto de este empleado». Guarda el archivo y la descripción.
- **Content OS** es dueño de todo lo que pasa después (Drive, IA, posts).
- Dos bases distintas, **sin claves cruzadas**. El vínculo es
  `cos_assets.source = 'turnos'` + `cos_assets.source_external_id = content_submissions.id`.
- Content OS **consulta** a Turnos (pull). Turnos nunca llama a Content OS.

## Lado Turnos

### Migración `0142_content_submissions.sql` (⚠️ verificar el número al escribirla)

```sql
create table public.content_submissions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  kitchen_id   uuid references public.kitchens(id),
  brand_slug   text not null,                  -- slug de Turnos (sensaciones|bijutsukan|fasutofudo)
  created_by   uuid not null references public.users(id),
  storage_path text not null,                  -- dentro del bucket content-inbox
  mime         text not null,
  size_bytes   bigint,
  duration_ms  int,
  description  text not null check (char_length(btrim(description)) >= 15),
  priority     text not null default 'normal' check (priority in ('normal', 'alta')),
  status       text not null default 'uploading'
                 check (status in ('uploading', 'submitted', 'ingested', 'rejected')),
  external_ref text,                           -- id del asset en Content OS (lo manda el ack)
  ingested_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index content_submissions_pending on public.content_submissions (created_at)
  where status = 'submitted';

alter table public.users add column can_send_content boolean not null default false;
```

- **Bucket privado `content-inbox`**, 500 MB por archivo (revisar el límite global del
  proyecto de Supabase antes, igual que con `stories`).
- RLS: el empleado ve **solo sus propios envíos**; nadie más que el servidor escribe.

### Permiso

- **Por persona**, nunca por rol (misma regla que Historias): `users.can_send_content`.
  Arranca en `false` para todos. Se prende a mano para 2 o 3 empleados de prueba.
- Si está en `false`, el botón **no aparece** en la PWA. Nadie ve nada distinto.
- Es **voluntario**: mandar fotos para redes no es un evento laboral ni se usa para control.
  Respeta el principio rector de Turnos (nada de vigilancia).

### PWA (`admin/src/app/(operario)/…`)

1. Botón «📸 Enviar contenido» (solo si `can_send_content`).
2. Cámara o galería. Foto o video.
3. **Descripción obligatoria**, 15 caracteres mínimo, con ayudas («¿qué producto es?»,
   «¿algo especial hoy?», «¿es para historia?»). El botón «Enviar» no se habilita sin eso.
4. Marca: solo las marcas de la cocina del empleado (`kitchens.brand_slugs`). Si hay una,
   se completa sola.
5. Subida **directa** al bucket con URL firmada, igual que `admin/src/lib/stories.ts`
   (`createSignedUploadUrl`): el archivo no pasa por la API en base64.
6. Al terminar la subida → `status = 'submitted'`.
7. Pantalla final: «¡Listo! Lo va a revisar Javier. Si se publica, te avisamos».

Referencia visual: la pantalla «Enviar contenido» de la maqueta
(https://claude.ai/artifact/HwXuKvr4sYAPSp7ZSP1Ytk).

### API para Content OS

Autenticación: header **`x-content-os-secret`** = `CONTENT_OS_SECRET` (mismo patrón que
`x-cron-secret` de `/api/jobs/*`). Comparación en tiempo constante. Sin secreto → 401.

**`GET /api/v1/integrations/content/pending?limit=20`**

```json
{
  "items": [
    {
      "id": "uuid",
      "brand_slug": "fasutofudo",
      "kitchen_name": "Paternal",
      "submitted_by": "Mica",               // apodo si tiene, si no el nombre de pila
      "description": "Caja con los 3 onigiris recién armados",
      "priority": "normal",
      "mime": "image/jpeg",
      "size_bytes": 348120,
      "duration_ms": null,
      "created_at": "2026-09-26T18:20:00Z",
      "download_url": "https://…/content-inbox/…?token=…"   // firmada, 1 hora
    }
  ]
}
```

Solo `status = 'submitted'`, del más viejo al más nuevo.

**`POST /api/v1/integrations/content/:id/ack`** con `{ "external_ref": "<asset id>" }`

- Pasa a `ingested`, guarda `external_ref` e `ingested_at`.
- **Idempotente:** si ya estaba `ingested` con el mismo `external_ref` → 200 igual.
  Con otro `external_ref` → 409.

**Limpieza:** un job de Turnos borra del bucket los archivos `ingested` hace más de 14 días
(el original ya vive en el almacenamiento de Content OS).

## Lado Content OS

Trabajo `ingest:turnos` en el worker, cada 2 minutos:

1. `GET pending`.
2. Por cada envío: bajar desde `download_url` → subir a `cos-media`
   (`originals/<marca>/<AAAA-MM>/<id>.<ext>`, o a Drive el día de la conexión).
3. Crear `cos_assets` con `source = 'turnos'`, `source_external_id = id`, la descripción,
   `submitted_by_label` y `kitchen_label`. El `unique (source, source_external_id)` impide
   duplicados si se corta a mitad de camino.
4. Encolar `asset:process`.
5. `POST ack` con el id del asset. Si el ack falla, el próximo ciclo reintenta: el asset
   ya existe (lo encuentra por el unique) y solo repite el ack.

Mapa de marcas: `cos_brands.turnos_slugs` (hoy `sensaciones`, `bijutsukan`, `fasutofudo`).
Un `brand_slug` sin marca en Content OS se deja sin ack y aparece como alerta en Inicio.

Variables en Content OS: `TURNOS_BASE_URL`, `CONTENT_OS_SECRET`.

-- ============================================================================
-- Content OS — modo simulación, almacenamiento intercambiable y el reloj
-- PLAN-CONTENT-OS.md §8 (Drive) y §14 Fase 1 ("primero todo armado, conexiones al final")
--
-- · publish_mode 'simulated': el flujo completo funciona pero "publicar" no sale a Meta.
--   Cada post publicado así queda con simulated = true y nunca se confunde con uno real.
-- · storage_driver: 'supabase' (bucket privado cos-media, mientras tanto) o 'drive'
--   (la cuenta dedicada, el día de la conexión). Cada archivo recuerda dónde vive.
-- · cos_scheduler_tick(): el reloj. Lo llama el worker cada minuto. Toda la lógica de
--   tiempos vive acá (una sola fuente, probada con PGlite):
--     1. lo que sigue esperando aprobación y ya pasó su hora → EXPIRED (no se publica)
--     2. con pausa general, no se hace nada más
--     3. lo programado que quedó atrás más de la tolerancia → MISSED (MISSED_POST_POLICY)
--     4. lo programado que ya es hora, y los reintentos vencidos → trabajo post:publish
--     5. lo que quedó "publicando" más de 10 min (worker caído) → trabajo post:reconcile
--   Reemplaza a shared/cos/missed-policy.ts.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Configuración
-- ---------------------------------------------------------------------------
alter table public.cos_settings
  add column publish_mode   text not null default 'simulated' check (publish_mode in ('simulated', 'live')),
  add column storage_driver text not null default 'supabase'  check (storage_driver in ('supabase', 'drive'));

-- ---------------------------------------------------------------------------
-- Dónde vive cada archivo
-- ---------------------------------------------------------------------------
alter table public.cos_assets
  add column storage_driver text check (storage_driver in ('supabase', 'drive')),
  add column storage_key    text,                    -- ruta en el bucket (supabase) o id (drive)
  add column thumb_key      text,                    -- miniatura JPG en cos-media (siempre supabase)
  add column sha256         text;                    -- para detectar el mismo archivo subido dos veces
create index cos_assets_sha256 on public.cos_assets (brand_id, sha256) where sha256 is not null;

-- La tabla está vacía y las versiones son inmutables solo para UPDATE/DELETE de filas:
-- agregar columnas no dispara el trigger.
alter table public.cos_asset_versions alter column drive_file_id drop not null;
alter table public.cos_asset_versions
  add column storage_driver text not null default 'supabase' check (storage_driver in ('supabase', 'drive')),
  add column storage_key    text,
  add constraint cos_versions_location check (drive_file_id is not null or storage_key is not null);

alter table public.cos_posts
  add column simulated boolean not null default false;

-- ---------------------------------------------------------------------------
-- Consentimiento (PLAN §15): si la IA marca caras de clientes o menores, el asset
-- queda con consent = 'blocked' y NINGÚN post que lo use llega a SCHEDULED ni a
-- PUBLISHING hasta que una persona lo revise y lo pase a 'ok'.
-- Se agrega como un trigger aparte (no se reescribe el guardián de 0001).
-- ---------------------------------------------------------------------------
create or replace function public.cos_posts_consent_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status in ('SCHEDULED', 'PUBLISHING') and new.status is distinct from old.status and exists (
    select 1 from public.cos_post_media m
    join public.cos_asset_versions v on v.id = m.version_id
    join public.cos_assets a on a.id = v.asset_id
    where m.post_id = new.id and a.consent = 'blocked'
  ) then
    raise exception 'cos: el post usa una foto o video bloqueado por consentimiento (revisalo antes)'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger cos_posts_consent_guard before update on public.cos_posts
  for each row execute function public.cos_posts_consent_guard();

-- ---------------------------------------------------------------------------
-- Bucket privado para los medios mientras no está Drive (y para miniaturas siempre).
-- 500 MB por archivo: si el límite global del proyecto es menor, manda ese.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('cos-media', 'cos-media', false, 524288000)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- El reloj
-- ---------------------------------------------------------------------------
create or replace function public.cos_scheduler_tick()
returns jsonb language plpgsql set search_path = public as $$
declare
  v_s          public.cos_settings;
  v_expired    int := 0;
  v_missed     int := 0;
  v_publish    int := 0;
  v_reconcile  int := 0;
  v_tolerance  interval;
  r            record;
begin
  select * into v_s from public.cos_settings where id;
  perform set_config('cos.actor', 'worker:reloj', true);

  -- 1. Sin aprobar y ya pasó la hora: se vence. Nunca se publica algo no aprobado.
  update public.cos_posts
     set status = 'EXPIRED',
         last_error = 'Llegó la hora y no estaba aprobado'
   where status = 'PENDING_APPROVAL' and scheduled_at is not null and scheduled_at < now();
  get diagnostics v_expired = row_count;

  -- 2. Pausa general: se congela todo lo demás (lo programado espera).
  if v_s.global_pause then
    return jsonb_build_object('paused', true, 'expired', v_expired);
  end if;

  -- 3. Llegamos tarde (worker caído, reinicio). 1 minuto de gracia siempre; con la
  --    política flexible, hasta la tolerancia (30 min por defecto).
  v_tolerance := case
    when v_s.missed_post_policy = 'never_publish_late' then interval '1 minute'
    else make_interval(mins => greatest(v_s.late_tolerance_min, 1))
  end;
  update public.cos_posts
     set status = 'MISSED',
         last_error = format('Se llegó %s min tarde (tolerancia %s min): reprogramalo',
                             floor(extract(epoch from now() - scheduled_at) / 60),
                             floor(extract(epoch from v_tolerance) / 60))
   where status = 'SCHEDULED' and scheduled_at < now() - v_tolerance;
  get diagnostics v_missed = row_count;

  -- 4. A publicar. La dedupe_key impide dos publicaciones vivas del mismo post.
  --    max_attempts = 1: los reintentos de un post los maneja el post (RETRY_SCHEDULED),
  --    nunca la cola a ciegas.
  for r in
    select id from public.cos_posts where status = 'SCHEDULED' and scheduled_at <= now()
    union all
    select id from public.cos_posts where status = 'RETRY_SCHEDULED' and next_attempt_at <= now()
  loop
    perform public.cos_enqueue_job('post:publish', jsonb_build_object('post_id', r.id), now(),
                                   'publish:' || r.id::text, 1);
    v_publish := v_publish + 1;
  end loop;

  -- 5. Publicando hace más de 10 minutos y sin trabajo vivo: averiguar qué pasó.
  for r in
    select p.id from public.cos_posts p
    where p.status = 'PUBLISHING' and p.updated_at < now() - interval '10 minutes'
      and not exists (select 1 from public.cos_jobs j
                      where j.dedupe_key = 'publish:' || p.id::text and j.status in ('queued', 'running'))
  loop
    perform public.cos_enqueue_job('post:reconcile', jsonb_build_object('post_id', r.id), now(),
                                   'reconcile:' || r.id::text, 3);
    v_reconcile := v_reconcile + 1;
  end loop;

  return jsonb_build_object('paused', false, 'expired', v_expired, 'missed', v_missed,
                            'publish', v_publish, 'reconcile', v_reconcile);
end $$;

revoke execute on function public.cos_scheduler_tick() from public, anon, authenticated;
grant execute on function public.cos_scheduler_tick() to service_role;

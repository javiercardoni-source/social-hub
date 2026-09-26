-- ============================================================================
-- Content OS — base (Fase 0 / Fase 1)                         PLAN-CONTENT-OS.md §4
--
-- La base OlivosSpeed es COMPARTIDA con otras apps: todo lo de Content OS lleva el
-- prefijo `cos_` y nada de este archivo toca tablas ajenas.
--
-- Reglas de seguridad que se hacen cumplir ACÁ (no solo en el código):
--   · RLS en todas las tablas. Leer: solo miembros (cos_members). Escribir: solo
--     service_role (acciones de servidor que ya verificaron el rol, y el worker).
--   · Un asset no llega a READY sin descripción de al menos 15 caracteres.
--   · La aprobación la sella la base con un hash del contenido. Si el contenido
--     cambia, el post vuelve solo a PENDING_APPROVAL; nada llega a SCHEDULED ni a
--     PUBLISHING si el contenido no es exactamente el aprobado.
--   · Las versiones de un asset son inmutables (solo INSERT).
--   · La auditoría es solo de agregado.
--   · La cola no admite dos trabajos vivos con la misma dedupe_key.
--
-- La clave de idempotencia de un post es su propio `id` (§6): no hace falta otra
-- columna. El worker la usa como dedupe_key = 'publish:<id>'.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
create or replace function public.cos_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Miembros: quién puede entrar a Content OS (hoy entra cualquier usuario de
-- OlivosSpeed a Social Hub; esto lo cierra).
-- ---------------------------------------------------------------------------
create table public.cos_members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         text not null check (role in ('admin', 'approver', 'editor', 'viewer')),
  display_name text,
  created_at   timestamptz not null default now()
);

-- SECURITY DEFINER para que las políticas puedan consultarla sin recursión de RLS.
create or replace function public.cos_is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cos_members where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Marcas y cuentas sociales
-- ---------------------------------------------------------------------------
create table public.cos_brands (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name            text not null,
  color           text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  turnos_slugs    text[] not null default '{}',   -- mapa a los slugs de marca de Turnos
  tone_md         text not null default '',       -- sale del knowledge-base (script sync-brands)
  rules_json      jsonb not null default '{}'::jsonb,
  whatsapp_number text check (whatsapp_number ~ '^[0-9]{10,15}$'),  -- sin "+", como en wa.me
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger cos_brands_touch before update on public.cos_brands
  for each row execute function public.cos_touch_updated_at();

create table public.cos_social_accounts (
  id                     uuid primary key default gen_random_uuid(),
  brand_id               uuid not null references public.cos_brands(id) on delete restrict,
  platform               text not null check (platform in ('instagram', 'facebook', 'tiktok')),
  external_id            text not null,          -- Page ID / IG business ID
  display_name           text not null,
  -- NOMBRE de la variable de entorno con el token. El token nunca entra a la base.
  token_ref              text check (token_ref ~ '^[A-Z][A-Z0-9_]*$'),
  status                 text not null default 'pending'
                           check (status in ('pending', 'connected', 'error', 'disabled')),
  last_checked_at        timestamptz,
  last_error             text,
  webhooks_subscribed_at timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (platform, external_id),
  unique (id, brand_id, platform)                -- para la FK compuesta de cos_posts
);
create trigger cos_social_accounts_touch before update on public.cos_social_accounts
  for each row execute function public.cos_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Assets (fotos y videos) y sus versiones
-- ---------------------------------------------------------------------------
create table public.cos_assets (
  id                 uuid primary key default gen_random_uuid(),
  brand_id           uuid not null references public.cos_brands(id) on delete restrict,
  source             text not null check (source in ('turnos', 'manual', 'drive')),
  source_external_id text,                        -- turnos: content_submissions.id
  description        text,
  submitted_by_label text,
  kitchen_label      text,
  drive_file_id      text,
  drive_md5          text,
  mime               text,
  media_type         text check (media_type in ('photo', 'video')),
  width              int check (width > 0),
  height             int check (height > 0),
  duration_ms        int check (duration_ms >= 0),
  size_bytes         bigint check (size_bytes >= 0),
  captured_at        timestamptz,
  status             text not null default 'NEW' check (status in (
                       'NEW', 'VALIDATING', 'READY', 'IN_USE', 'ARCHIVED',
                       'MISSING_DESCRIPTION', 'REJECTED', 'FAILED_SYNC', 'FAILED_PROCESSING')),
  ai_json            jsonb,
  quality_score      smallint check (quality_score between 0 and 100),
  people_present     boolean,
  consent            text not null default 'unknown' check (consent in ('unknown', 'ok', 'blocked')),
  current_version_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (source, source_external_id),
  -- Sin descripción no hay READY, ni IA, ni publicación (no negociable del paquete).
  constraint cos_assets_description_required check (
    status in ('NEW', 'VALIDATING', 'MISSING_DESCRIPTION', 'REJECTED', 'FAILED_SYNC', 'ARCHIVED')
    or char_length(btrim(coalesce(description, ''))) >= 15
  )
);
create index cos_assets_brand_status on public.cos_assets (brand_id, status, created_at desc);
create trigger cos_assets_touch before update on public.cos_assets
  for each row execute function public.cos_touch_updated_at();

create table public.cos_asset_versions (
  id                uuid primary key default gen_random_uuid(),
  asset_id          uuid not null references public.cos_assets(id) on delete restrict,
  version_number    int not null check (version_number >= 1),
  parent_version_id uuid references public.cos_asset_versions(id),
  kind              text not null check (kind in ('original', 'ffmpeg', 'canva', 'manual')),
  aspect            text not null default 'orig' check (aspect in ('orig', '9:16', '4:5', '1:1')),
  drive_file_id     text not null,
  mime              text,
  width             int check (width > 0),
  height            int check (height > 0),
  duration_ms       int check (duration_ms >= 0),
  size_bytes        bigint check (size_bytes >= 0),
  params_json       jsonb not null default '{}'::jsonb,
  created_by        text not null default 'worker',
  created_at        timestamptz not null default now(),
  unique (asset_id, version_number)
);

-- Una versión nueva es una fila nueva: nunca se modifica ni se borra la anterior.
create or replace function public.cos_versions_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'cos: las versiones son inmutables (se crea una nueva, nunca se pisa)'
    using errcode = 'check_violation';
end $$;
create trigger cos_asset_versions_immutable before update or delete on public.cos_asset_versions
  for each row execute function public.cos_versions_immutable();

alter table public.cos_assets
  add constraint cos_assets_current_version_fk
  foreign key (current_version_id) references public.cos_asset_versions(id);

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------
create table public.cos_posts (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references public.cos_brands(id) on delete restrict,
  account_id          uuid not null,
  platform            text not null check (platform in ('instagram', 'facebook', 'tiktok')),
  post_type           text not null check (post_type in ('feed', 'carousel', 'reel', 'story')),
  caption             text not null default '',
  hashtags            text not null default '',
  scheduled_at        timestamptz,
  timezone            text not null default 'America/Argentina/Buenos_Aires',
  status              text not null default 'DRAFT' check (status in (
                        'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PAUSED',
                        'PUBLISHING', 'PUBLISHED', 'FAILED', 'RETRY_SCHEDULED',
                        'REJECTED', 'CANCELLED', 'EXPIRED', 'MISSED')),
  approved_by         uuid references auth.users(id),
  approved_at         timestamptz,
  approved_hash       text,
  attempts            int not null default 0 check (attempts >= 0),
  next_attempt_at     timestamptz,
  remote_container_id text,
  remote_post_id      text,
  permalink           text,
  published_at        timestamptz,
  last_error          text,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- La cuenta tiene que ser de la misma marca y de la misma red que el post.
  constraint cos_posts_account_fk foreign key (account_id, brand_id, platform)
    references public.cos_social_accounts (id, brand_id, platform) on delete restrict
);
create index cos_posts_status_sched on public.cos_posts (status, scheduled_at);
create index cos_posts_brand on public.cos_posts (brand_id, created_at desc);
create unique index cos_posts_remote_unique on public.cos_posts (platform, remote_post_id)
  where remote_post_id is not null;

create table public.cos_post_media (
  post_id    uuid not null references public.cos_posts(id) on delete cascade,
  version_id uuid not null references public.cos_asset_versions(id) on delete restrict,
  position   smallint not null check (position >= 0),
  primary key (post_id, position)
);

-- Transiciones permitidas de un post (§5). Única fuente de verdad: el test
-- `post-states.test.ts` verifica que la copia en TypeScript sea idéntica.
create or replace function public.cos_post_transitions()
returns table (from_status text, to_status text) language sql immutable as $$
  values
    ('DRAFT', 'PENDING_APPROVAL'), ('DRAFT', 'CANCELLED'),
    ('PENDING_APPROVAL', 'APPROVED'), ('PENDING_APPROVAL', 'REJECTED'),
    ('PENDING_APPROVAL', 'DRAFT'), ('PENDING_APPROVAL', 'CANCELLED'),
    ('PENDING_APPROVAL', 'EXPIRED'),
    ('APPROVED', 'SCHEDULED'), ('APPROVED', 'PENDING_APPROVAL'), ('APPROVED', 'CANCELLED'),
    ('SCHEDULED', 'PUBLISHING'), ('SCHEDULED', 'PAUSED'), ('SCHEDULED', 'CANCELLED'),
    ('SCHEDULED', 'PENDING_APPROVAL'), ('SCHEDULED', 'MISSED'),
    ('PAUSED', 'SCHEDULED'), ('PAUSED', 'CANCELLED'), ('PAUSED', 'PENDING_APPROVAL'),
    ('PUBLISHING', 'PUBLISHED'), ('PUBLISHING', 'FAILED'),
    ('FAILED', 'RETRY_SCHEDULED'), ('FAILED', 'CANCELLED'), ('FAILED', 'PENDING_APPROVAL'),
    ('RETRY_SCHEDULED', 'PUBLISHING'), ('RETRY_SCHEDULED', 'PAUSED'),
    ('RETRY_SCHEDULED', 'CANCELLED'), ('RETRY_SCHEDULED', 'PENDING_APPROVAL'),
    ('MISSED', 'PENDING_APPROVAL'), ('MISSED', 'CANCELLED'),
    ('REJECTED', 'DRAFT'),
    ('EXPIRED', 'DRAFT'), ('EXPIRED', 'PENDING_APPROVAL')
$$;

-- Hash del contenido publicable: texto + cuenta + tipo + fecha + archivos en orden.
-- Es lo que se "firma" al aprobar (approved_hash).
create or replace function public.cos_compute_post_hash(
  p_post_id uuid, p_caption text, p_hashtags text, p_account_id uuid,
  p_post_type text, p_scheduled_at timestamptz
) returns text language sql stable set search_path = public as $$
  select encode(sha256(convert_to(concat_ws(
    E'\x1f',
    coalesce(p_caption, ''),
    coalesce(p_hashtags, ''),
    coalesce(p_account_id::text, ''),
    coalesce(p_post_type, ''),
    coalesce(to_char(p_scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), ''),
    coalesce((select string_agg(m.position::text || ':' || m.version_id::text, ',' order by m.position)
              from public.cos_post_media m where m.post_id = p_post_id), '')
  ), 'UTF8')), 'hex');
$$;

create or replace function public.cos_post_content_hash(p_post_id uuid)
returns text language sql stable set search_path = public as $$
  select public.cos_compute_post_hash(p.id, p.caption, p.hashtags, p.account_id, p.post_type, p.scheduled_at)
  from public.cos_posts p where p.id = p_post_id;
$$;

-- Guardián de los posts: transiciones válidas, aprobación sellada por la base y
-- vuelta a aprobación cuando cambia algo de lo aprobado.
create or replace function public.cos_posts_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_content_changed boolean;
  v_hash text;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('DRAFT', 'PENDING_APPROVAL') then
      raise exception 'cos: un post nace como DRAFT o PENDING_APPROVAL, no %', new.status
        using errcode = 'check_violation';
    end if;
    new.approved_by := null; new.approved_at := null; new.approved_hash := null;
    return new;
  end if;

  v_content_changed :=
    (new.caption, new.hashtags, new.account_id, new.post_type, new.scheduled_at, new.brand_id, new.platform)
    is distinct from
    (old.caption, old.hashtags, old.account_id, old.post_type, old.scheduled_at, old.brand_id, old.platform);

  if v_content_changed and old.status in ('PUBLISHING', 'PUBLISHED') then
    raise exception 'cos: un post en % no se puede editar', old.status using errcode = 'check_violation';
  end if;

  -- Editar algo que ya estaba aprobado (o en camino) lo devuelve a aprobación.
  if v_content_changed and new.status = old.status and old.status in
     ('APPROVED', 'SCHEDULED', 'PAUSED', 'RETRY_SCHEDULED', 'FAILED', 'MISSED', 'EXPIRED') then
    new.status := 'PENDING_APPROVAL';
  end if;

  if new.status is distinct from old.status and not exists (
    select 1 from public.cos_post_transitions() t
    where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'cos: transición no permitida % → %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Toda vuelta atrás borra la aprobación.
  if new.status in ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'EXPIRED') then
    new.approved_by := null; new.approved_at := null; new.approved_hash := null;
  end if;

  v_hash := public.cos_compute_post_hash(new.id, new.caption, new.hashtags, new.account_id,
                                         new.post_type, new.scheduled_at);

  if new.status = 'APPROVED' and old.status <> 'APPROVED' then
    if new.approved_by is null then
      raise exception 'cos: falta quién aprueba (approved_by)' using errcode = 'check_violation';
    end if;
    new.approved_at := now();
    new.approved_hash := v_hash;          -- lo sella la base, no el cliente
  elsif new.approved_hash is distinct from old.approved_hash
        and new.status not in ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'EXPIRED') then
    raise exception 'cos: approved_hash solo lo escribe la base al aprobar' using errcode = 'check_violation';
  end if;

  if new.status in ('SCHEDULED', 'PUBLISHING') then
    if new.approved_hash is null or new.approved_hash <> v_hash then
      raise exception 'cos: el contenido no coincide con lo aprobado' using errcode = 'check_violation';
    end if;
    if new.status = 'SCHEDULED' and new.scheduled_at is null then
      raise exception 'cos: no se puede programar sin fecha' using errcode = 'check_violation';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger cos_posts_guard before insert or update on public.cos_posts
  for each row execute function public.cos_posts_guard();

-- Solo se borra lo que nunca salió.
create or replace function public.cos_posts_delete_guard()
returns trigger language plpgsql as $$
begin
  if old.status not in ('DRAFT', 'REJECTED', 'CANCELLED', 'EXPIRED') then
    raise exception 'cos: un post en % no se puede borrar (cancelalo)', old.status
      using errcode = 'check_violation';
  end if;
  return old;
end $$;
create trigger cos_posts_delete_guard before delete on public.cos_posts
  for each row execute function public.cos_posts_delete_guard();

-- Cambiar los archivos de un post también lo devuelve a aprobación.
create or replace function public.cos_post_media_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_post_id uuid := coalesce(new.post_id, old.post_id);
  v_status text;
begin
  select status into v_status from public.cos_posts where id = v_post_id;
  if v_status is null then
    return null;                          -- el post se está borrando (cascade)
  end if;
  if v_status in ('PUBLISHING', 'PUBLISHED') then
    raise exception 'cos: no se cambian los archivos de un post en %', v_status
      using errcode = 'check_violation';
  end if;
  if v_status in ('APPROVED', 'SCHEDULED', 'PAUSED', 'RETRY_SCHEDULED', 'FAILED', 'MISSED', 'EXPIRED') then
    update public.cos_posts set status = 'PENDING_APPROVAL' where id = v_post_id;
  end if;
  return null;
end $$;
create trigger cos_post_media_guard after insert or update or delete on public.cos_post_media
  for each row execute function public.cos_post_media_guard();

-- ---------------------------------------------------------------------------
-- Cola de trabajos (§3, §6, §18.2: cola propia en Postgres con SKIP LOCKED)
-- ---------------------------------------------------------------------------
create table public.cos_jobs (
  id           bigint generated always as identity primary key,
  type         text not null check (type ~ '^[a-z0-9_:.-]+$'),
  payload      jsonb not null default '{}'::jsonb,
  run_at       timestamptz not null default now(),
  status       text not null default 'queued'
                 check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts     int not null default 0 check (attempts >= 0),
  max_attempts int not null default 5 check (max_attempts between 1 and 50),
  dedupe_key   text,
  locked_by    text,
  locked_at    timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  finished_at  timestamptz
);
-- No puede haber dos trabajos VIVOS con la misma clave (p. ej. 'publish:<post_id>').
create unique index cos_jobs_dedupe_live on public.cos_jobs (dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running');
create index cos_jobs_ready on public.cos_jobs (run_at, id) where status = 'queued';
create index cos_jobs_running on public.cos_jobs (locked_at) where status = 'running';

-- Encola. Si ya hay uno vivo con la misma dedupe_key, devuelve ese (no duplica).
create or replace function public.cos_enqueue_job(
  p_type text, p_payload jsonb default '{}'::jsonb, p_run_at timestamptz default now(),
  p_dedupe_key text default null, p_max_attempts int default 5
) returns bigint language plpgsql set search_path = public as $$
declare
  v_id bigint;
begin
  insert into public.cos_jobs (type, payload, run_at, dedupe_key, max_attempts)
  values (p_type, coalesce(p_payload, '{}'::jsonb), coalesce(p_run_at, now()), p_dedupe_key, p_max_attempts)
  on conflict (dedupe_key) where dedupe_key is not null and status in ('queued', 'running')
  do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.cos_jobs
    where dedupe_key = p_dedupe_key and status in ('queued', 'running');
  end if;
  return v_id;
end $$;

-- Reclama hasta p_limit trabajos listos. Un trabajo 'running' cuyo worker murió
-- (lease vencido) se vuelve a reclamar; si ya agotó sus intentos, se da por fallido.
create or replace function public.cos_claim_jobs(
  p_worker text, p_types text[] default null, p_limit int default 1,
  p_lease interval default interval '5 minutes'
) returns setof public.cos_jobs language plpgsql set search_path = public as $$
begin
  update public.cos_jobs
     set status = 'failed', finished_at = now(), updated_at = now(),
         last_error = coalesce(last_error || ' · ', '') || 'lease vencido sin intentos restantes'
   where status = 'running' and locked_at < now() - p_lease and attempts >= max_attempts;

  return query
  with c as (
    select j.id from public.cos_jobs j
    where j.run_at <= now()
      and (p_types is null or j.type = any (p_types))
      and (j.status = 'queued' or (j.status = 'running' and j.locked_at < now() - p_lease))
    order by j.run_at, j.id
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.cos_jobs j
     set status = 'running', locked_by = p_worker, locked_at = now(),
         attempts = j.attempts + 1, updated_at = now()
    from c
   where j.id = c.id
  returning j.*;
end $$;

-- Renueva el lease de un trabajo largo (p. ej. subir un video). false = ya no es tuyo.
create or replace function public.cos_touch_job(p_id bigint, p_worker text)
returns boolean language sql set search_path = public as $$
  with u as (
    update public.cos_jobs set locked_at = now(), updated_at = now()
    where id = p_id and status = 'running' and locked_by = p_worker
    returning 1
  ) select exists (select 1 from u);
$$;

-- Terminado. Solo lo puede cerrar quien lo tiene tomado (un lease robado no se cierra).
create or replace function public.cos_complete_job(p_id bigint, p_worker text)
returns boolean language sql set search_path = public as $$
  with u as (
    update public.cos_jobs
       set status = 'done', finished_at = now(), updated_at = now(), locked_by = null, locked_at = null
     where id = p_id and status = 'running' and locked_by = p_worker
    returning 1
  ) select exists (select 1 from u);
$$;

-- Falló. Si quedan intentos, vuelve a la cola con espera exponencial
-- (30 s, 1 min, 2 min, 4 min… tope 1 h) salvo que el llamador indique otra.
-- p_permanent = true lo da por fallido sin reintentar (p. ej. token inválido).
create or replace function public.cos_fail_job(
  p_id bigint, p_worker text, p_error text,
  p_retry_in interval default null, p_permanent boolean default false
) returns text language plpgsql set search_path = public as $$
declare
  v_job public.cos_jobs;
begin
  select * into v_job from public.cos_jobs
  where id = p_id and status = 'running' and locked_by = p_worker
  for update;
  if not found then
    return 'not_owner';
  end if;

  if p_permanent or v_job.attempts >= v_job.max_attempts then
    update public.cos_jobs
       set status = 'failed', last_error = left(p_error, 4000), finished_at = now(),
           updated_at = now(), locked_by = null, locked_at = null
     where id = p_id;
    return 'failed';
  end if;

  update public.cos_jobs
     set status = 'queued', last_error = left(p_error, 4000), updated_at = now(),
         locked_by = null, locked_at = null,
         run_at = now() + coalesce(
           p_retry_in,
           least(interval '1 hour', interval '30 seconds' * power(2, greatest(v_job.attempts - 1, 0)))
         )
   where id = p_id;
  return 'retry';
end $$;

create trigger cos_jobs_touch before update on public.cos_jobs
  for each row execute function public.cos_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Configuración (una sola fila)
-- ---------------------------------------------------------------------------
create table public.cos_settings (
  id                 boolean primary key default true check (id),
  -- Modo seguro FIJO durante la prueba: para apagarlo hay que quitar este check
  -- con una migración, a propósito.
  safe_mode          boolean not null default true check (safe_mode),
  global_pause       boolean not null default false,
  -- Fase 2A apagada por decisión de Javier (26-09-2026) hasta el trámite con Meta.
  triggers_pause     boolean not null default true,
  missed_post_policy text not null default 'publish_within_tolerance'
                       check (missed_post_policy in ('publish_within_tolerance', 'never_publish_late')),
  late_tolerance_min int not null default 30 check (late_tolerance_min between 0 and 1440),
  drive_root_id      text,
  ai_model           text not null default 'claude-sonnet-5',
  ai_model_light     text not null default 'claude-haiku-4-5',
  updated_by         uuid references auth.users(id),
  updated_at         timestamptz not null default now()
);
insert into public.cos_settings (id) values (true) on conflict (id) do nothing;
create trigger cos_settings_touch before update on public.cos_settings
  for each row execute function public.cos_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Auditoría y consumo de IA
-- ---------------------------------------------------------------------------
create table public.cos_audit_log (
  id           bigint generated always as identity primary key,
  event        text not null,
  entity_type  text not null,
  entity_id    text,
  actor        text not null,
  details_json jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index cos_audit_entity on public.cos_audit_log (entity_type, entity_id, created_at desc);

create or replace function public.cos_audit_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'cos: la auditoría es solo de agregado' using errcode = 'check_violation';
end $$;
create trigger cos_audit_append_only before update or delete on public.cos_audit_log
  for each row execute function public.cos_audit_append_only();

-- Cada cambio de estado de un post queda auditado solo, pase por donde pase.
-- El actor sale de `cos.actor` (lo setea quien escribe) o del rol de la base.
create or replace function public.cos_posts_audit()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.cos_audit_log (event, entity_type, entity_id, actor, details_json)
    values (
      'post.status', 'post', new.id::text,
      coalesce(nullif(current_setting('cos.actor', true), ''), current_user),
      jsonb_build_object(
        'from', case when tg_op = 'INSERT' then null else old.status end,
        'to', new.status,
        'approved_by', new.approved_by,
        'error', new.last_error
      )
    );
  end if;
  return null;
end $$;
create trigger cos_posts_audit after insert or update on public.cos_posts
  for each row execute function public.cos_posts_audit();

create table public.cos_ai_usage (
  id                bigint generated always as identity primary key,
  purpose           text not null,
  model             text not null,
  input_tokens      int not null default 0,
  output_tokens     int not null default 0,
  cache_read_tokens int not null default 0,
  cost_usd          numeric(10, 6),
  asset_id          uuid references public.cos_assets(id) on delete set null,
  post_id           uuid references public.cos_posts(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------------
alter table public.cos_members         enable row level security;
alter table public.cos_brands          enable row level security;
alter table public.cos_social_accounts enable row level security;
alter table public.cos_assets          enable row level security;
alter table public.cos_asset_versions  enable row level security;
alter table public.cos_posts           enable row level security;
alter table public.cos_post_media      enable row level security;
alter table public.cos_jobs            enable row level security;
alter table public.cos_settings        enable row level security;
alter table public.cos_audit_log       enable row level security;
alter table public.cos_ai_usage        enable row level security;

-- Lectura para miembros. Nadie escribe desde el navegador: solo service_role.
create policy cos_members_read         on public.cos_members         for select to authenticated using (public.cos_is_member());
create policy cos_brands_read          on public.cos_brands          for select to authenticated using (public.cos_is_member());
create policy cos_social_accounts_read on public.cos_social_accounts for select to authenticated using (public.cos_is_member());
create policy cos_assets_read          on public.cos_assets          for select to authenticated using (public.cos_is_member());
create policy cos_asset_versions_read  on public.cos_asset_versions  for select to authenticated using (public.cos_is_member());
create policy cos_posts_read           on public.cos_posts           for select to authenticated using (public.cos_is_member());
create policy cos_post_media_read      on public.cos_post_media      for select to authenticated using (public.cos_is_member());
create policy cos_jobs_read            on public.cos_jobs            for select to authenticated using (public.cos_is_member());
create policy cos_settings_read        on public.cos_settings        for select to authenticated using (public.cos_is_member());
create policy cos_audit_log_read       on public.cos_audit_log       for select to authenticated using (public.cos_is_member());
create policy cos_ai_usage_read        on public.cos_ai_usage        for select to authenticated using (public.cos_is_member());

-- Supabase da permisos amplios por defecto en `public`: se recortan explícitamente.
revoke all on public.cos_members, public.cos_brands, public.cos_social_accounts, public.cos_assets,
  public.cos_asset_versions, public.cos_posts, public.cos_post_media, public.cos_jobs,
  public.cos_settings, public.cos_audit_log, public.cos_ai_usage
  from anon, authenticated;
grant select on public.cos_members, public.cos_brands, public.cos_social_accounts, public.cos_assets,
  public.cos_asset_versions, public.cos_posts, public.cos_post_media, public.cos_jobs,
  public.cos_settings, public.cos_audit_log, public.cos_ai_usage
  to authenticated;
grant all on public.cos_members, public.cos_brands, public.cos_social_accounts, public.cos_assets,
  public.cos_asset_versions, public.cos_posts, public.cos_post_media, public.cos_jobs,
  public.cos_settings, public.cos_audit_log, public.cos_ai_usage
  to service_role;

-- Las funciones de la cola y del hash son solo para el servidor.
revoke execute on function
  public.cos_enqueue_job(text, jsonb, timestamptz, text, int),
  public.cos_claim_jobs(text, text[], int, interval),
  public.cos_touch_job(bigint, text),
  public.cos_complete_job(bigint, text),
  public.cos_fail_job(bigint, text, text, interval, boolean),
  public.cos_compute_post_hash(uuid, text, text, uuid, text, timestamptz),
  public.cos_post_content_hash(uuid)
  from public, anon, authenticated;
grant execute on function
  public.cos_enqueue_job(text, jsonb, timestamptz, text, int),
  public.cos_claim_jobs(text, text[], int, interval),
  public.cos_touch_job(bigint, text),
  public.cos_complete_job(bigint, text),
  public.cos_fail_job(bigint, text, text, interval, boolean),
  public.cos_compute_post_hash(uuid, text, text, uuid, text, timestamptz),
  public.cos_post_content_hash(uuid)
  to service_role;

revoke execute on function public.cos_is_member() from public, anon;
grant execute on function public.cos_is_member() to authenticated, service_role;

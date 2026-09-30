-- ============================================================================
-- Content OS — F8 Agenda automática (.gauntlet/features/f8-agenda/spec.md)
--
-- Decisión de Javier (30-09): se aprueba el CONTENIDO + una VENTANA. El motor puede mover la hora
-- dentro de la ventana; nunca algo que sale en menos de 3 h (ni llevarlo a menos de 3 h); lo que
-- se fija a mano (schedule_lock) no se mueve nunca. Cada movimiento queda en schedule_log.
--
-- Cómo lo hace cumplir la base:
--   · El hash de aprobación usa la VENTANA en vez de la hora exacta cuando el post tiene ventana y
--     no está fijado. Así mover la hora dentro de la ventana no devuelve a aprobación, y cambiar la
--     ventana sí.
--   · El guardián rechaza mover la hora de algo aprobado fuera de la ventana o a menos de 3 h.
--   · Sin ventana (o fijado a mano) todo queda como antes: la hora exacta es parte de lo aprobado.
--
-- Además:
--   · cos_weather_hourly: clima por hora (histórico de Open-Meteo archive + pronóstico 14 días).
--   · cos_media.contexto: clima y feriado del momento en que salió cada publicación (para aprender).
--   · cos_slot_models: foto diaria del modelo de horarios por cuenta y formato.
--   · cos_agenda_plans: el plan de la semana del agente, por marca.
--   · cos_brands: llave de la agenda, horarios de apertura (propuesta de la IA → confirmados),
--     llave de historias de clima.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Posts: ventana, origen del horario y registro
-- ---------------------------------------------------------------------------
alter table public.cos_posts
  add column window_start    timestamptz,
  add column window_end      timestamptz,
  add column schedule_lock   boolean not null default false,
  add column schedule_source text check (schedule_source in ('manual', 'motor', 'exploracion', 'fijo')),
  add column schedule_reason text,
  add column predicted_lift  numeric,
  add column schedule_log    jsonb not null default '[]'::jsonb,
  add constraint cos_posts_window_ok check (
    (window_start is null and window_end is null)
    or (window_start is not null and window_end is not null and window_end > window_start)
  );

-- La "identidad" del horario que se aprueba: la ventana (si hay y no está fijado) o la hora exacta.
create or replace function public.cos_schedule_identity(
  p_scheduled_at timestamptz, p_window_start timestamptz, p_window_end timestamptz, p_lock boolean
) returns text language sql immutable as $$
  select case
    when p_window_start is not null and not coalesce(p_lock, false)
      then 'W:' || to_char(p_window_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || '/' || to_char(p_window_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
    else 'T:' || coalesce(to_char(p_scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), '')
  end
$$;

create or replace function public.cos_compute_post_hash_v4(
  p_post_id uuid, p_caption text, p_hashtags text, p_account_id uuid,
  p_post_type text, p_scheduled_at timestamptz,
  p_overlay_text text, p_template text, p_music_key text,
  p_overlay_position text, p_overlay_layout text,
  p_window_start timestamptz, p_window_end timestamptz, p_lock boolean
) returns text language sql stable set search_path = public as $$
  select encode(sha256(convert_to(concat_ws(
    E'\x1f',
    -- Con ventana, la hora exacta no entra (la puede mover el motor dentro de la ventana).
    public.cos_compute_post_hash_v3(p_post_id, p_caption, p_hashtags, p_account_id, p_post_type,
      case when p_window_start is not null and not coalesce(p_lock, false) then null else p_scheduled_at end,
      p_overlay_text, p_template, p_music_key, p_overlay_position, p_overlay_layout),
    public.cos_schedule_identity(p_scheduled_at, p_window_start, p_window_end, p_lock)
  ), 'UTF8')), 'hex');
$$;

create or replace function public.cos_post_content_hash(p_post_id uuid)
returns text language sql stable set search_path = public as $$
  select public.cos_compute_post_hash_v4(p.id, p.caption, p.hashtags, p.account_id, p.post_type,
                                         p.scheduled_at, p.overlay_text, p.template, p.music_key,
                                         p.overlay_position, p.overlay_layout,
                                         p.window_start, p.window_end, p.schedule_lock)
  from public.cos_posts p where p.id = p_post_id;
$$;

-- Mismo guardián que en 0008, con la identidad del horario en vez de la hora exacta, y las
-- reglas del motor cuando mueve algo aprobado.
create or replace function public.cos_posts_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_content_changed boolean;
  v_hash text;
  v_moved boolean;
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
    (new.caption, new.hashtags, new.account_id, new.post_type,
     public.cos_schedule_identity(new.scheduled_at, new.window_start, new.window_end, new.schedule_lock),
     new.brand_id, new.platform,
     new.overlay_text, new.template, new.music_key, new.overlay_position, new.overlay_layout)
    is distinct from
    (old.caption, old.hashtags, old.account_id, old.post_type,
     public.cos_schedule_identity(old.scheduled_at, old.window_start, old.window_end, old.schedule_lock),
     old.brand_id, old.platform,
     old.overlay_text, old.template, old.music_key, old.overlay_position, old.overlay_layout);

  -- Publicado o publicándose: ni el contenido ni la hora se tocan.
  if (v_content_changed or new.scheduled_at is distinct from old.scheduled_at) and old.status in ('PUBLISHING', 'PUBLISHED') then
    raise exception 'cos: un post en % no se puede editar', old.status using errcode = 'check_violation';
  end if;

  if v_content_changed and new.status = old.status and old.status in
     ('APPROVED', 'SCHEDULED', 'PAUSED', 'RETRY_SCHEDULED', 'FAILED', 'MISSED', 'EXPIRED') then
    new.status := 'PENDING_APPROVAL';
  end if;

  -- El motor mueve la hora de algo aprobado (sin cambiar la ventana): solo dentro de la ventana y
  -- nunca a menos de 3 h (ni desde, ni hacia).
  v_moved := not v_content_changed
             and new.scheduled_at is distinct from old.scheduled_at
             and old.status in ('APPROVED', 'SCHEDULED', 'PAUSED', 'RETRY_SCHEDULED');
  if v_moved then
    if new.window_start is null or new.schedule_lock then
      raise exception 'cos: la hora de un post aprobado sin ventana no se mueve (devolvelo a aprobación)'
        using errcode = 'check_violation';
    end if;
    if new.scheduled_at is null or new.scheduled_at < new.window_start or new.scheduled_at > new.window_end then
      raise exception 'cos: la hora nueva queda fuera de la ventana aprobada' using errcode = 'check_violation';
    end if;
    if old.scheduled_at < now() + interval '3 hours' or new.scheduled_at < now() + interval '3 hours' then
      raise exception 'cos: no se mueve un post a menos de 3 h de salir' using errcode = 'check_violation';
    end if;
  end if;

  if new.status is distinct from old.status and not exists (
    select 1 from public.cos_post_transitions() t
    where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'cos: transición no permitida % → %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status in ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'EXPIRED') then
    new.approved_by := null; new.approved_at := null; new.approved_hash := null;
  end if;

  v_hash := public.cos_compute_post_hash_v4(new.id, new.caption, new.hashtags, new.account_id,
                                            new.post_type, new.scheduled_at,
                                            new.overlay_text, new.template, new.music_key,
                                            new.overlay_position, new.overlay_layout,
                                            new.window_start, new.window_end, new.schedule_lock);

  if new.status = 'APPROVED' and old.status <> 'APPROVED' then
    if new.approved_by is null then
      raise exception 'cos: falta quién aprueba (approved_by)' using errcode = 'check_violation';
    end if;
    new.approved_at := now();
    new.approved_hash := v_hash;
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
    -- Con ventana, la hora tiene que caer adentro.
    if new.window_start is not null and not new.schedule_lock
       and (new.scheduled_at < new.window_start or new.scheduled_at > new.window_end) then
      raise exception 'cos: la hora queda fuera de la ventana aprobada' using errcode = 'check_violation';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

revoke execute on function
  public.cos_compute_post_hash_v4(uuid, text, text, uuid, text, timestamptz, text, text, text, text, text, timestamptz, timestamptz, boolean),
  public.cos_schedule_identity(timestamptz, timestamptz, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function
  public.cos_compute_post_hash_v4(uuid, text, text, uuid, text, timestamptz, text, text, text, text, text, timestamptz, timestamptz, boolean),
  public.cos_schedule_identity(timestamptz, timestamptz, timestamptz, boolean)
  to service_role;

-- Lo que ya estaba aprobado queda igual: sin ventana, su hash (v4 = hora exacta) cambia de forma
-- respecto del v3. Se vuelve a sellar sin tocar nada más (mismo contenido, misma hora).
-- (El guardián no se dispara con esta actualización: solo cambia approved_hash, y se permite
--  porque el valor es el que la base calcula. Se hace con el trigger desactivado a propósito.)
alter table public.cos_posts disable trigger cos_posts_guard;
-- Solo lo que estaba bien sellado con el hash anterior (v3): un sello viejo que ya no coincidía
-- con el contenido NO se convierte en válido.
update public.cos_posts p set approved_hash = public.cos_post_content_hash(p.id)
where p.approved_hash is not null
  and p.approved_hash = public.cos_compute_post_hash_v3(p.id, p.caption, p.hashtags, p.account_id, p.post_type,
        p.scheduled_at, p.overlay_text, p.template, p.music_key, p.overlay_position, p.overlay_layout);
alter table public.cos_posts enable trigger cos_posts_guard;

-- ---------------------------------------------------------------------------
-- Clima por hora (histórico + pronóstico)
-- ---------------------------------------------------------------------------
create table public.cos_weather_hourly (
  ts          timestamptz primary key,           -- inicio de la hora (UTC)
  code        int,
  temp        numeric,
  precip_mm   numeric,
  precip_prob int,
  source      text not null check (source in ('archive', 'forecast')),
  updated_at  timestamptz not null default now()
);

-- Contexto del momento de cada publicación: { clima: 'lluvia'|…, temp, feriado: 'feriado'|'puente'|null, especial: nombre|null }
alter table public.cos_media
  add column contexto    jsonb,
  add column contexto_at timestamptz;

-- ---------------------------------------------------------------------------
-- Modelos de horario (foto diaria) y plan de la semana
-- ---------------------------------------------------------------------------
create table public.cos_slot_models (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.cos_social_accounts(id) on delete cascade,
  brand_id    uuid not null references public.cos_brands(id) on delete cascade,
  format      text not null check (format in ('feed', 'reel', 'story', 'carousel', 'video')),
  n           int not null check (n >= 0),
  model_json  jsonb not null,
  computed_at timestamptz not null default now()
);
create index cos_slot_models_latest on public.cos_slot_models (account_id, format, computed_at desc);

create table public.cos_agenda_plans (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.cos_brands(id) on delete cascade,
  plan_json   jsonb not null,                      -- [{ post_id, at, porque, fuente }]
  nota        text,                                -- lo que dice el agente de la semana
  agente      text not null check (agente in ('ia', 'motor')),  -- 'motor' = la IA falló y lo armó el asignador
  created_at  timestamptz not null default now()
);
create index cos_agenda_plans_brand on public.cos_agenda_plans (brand_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Marca: llaves y horarios de apertura
-- ---------------------------------------------------------------------------
alter table public.cos_brands
  add column agenda_auto            boolean not null default false,
  add column clima_historias        boolean not null default true,
  -- { "0": [{"desde": "19:00", "hasta": "23:30"}], "1": [], … } (0 = domingo). Confirmado por Javier.
  add column open_hours             jsonb,
  add column open_hours_propuesta   jsonb,          -- lo que sacó la IA de la web (a confirmar)
  add column open_hours_fuente      text,
  add column open_hours_at          timestamptz;

-- ---------------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------------
alter table public.cos_weather_hourly enable row level security;
alter table public.cos_slot_models    enable row level security;
alter table public.cos_agenda_plans   enable row level security;
create policy cos_weather_hourly_read on public.cos_weather_hourly for select to authenticated using (public.cos_is_member());
create policy cos_slot_models_read    on public.cos_slot_models    for select to authenticated using (public.cos_is_member());
create policy cos_agenda_plans_read   on public.cos_agenda_plans   for select to authenticated using (public.cos_is_member());
revoke all on public.cos_weather_hourly, public.cos_slot_models, public.cos_agenda_plans from anon, authenticated;
grant select on public.cos_weather_hourly, public.cos_slot_models, public.cos_agenda_plans to authenticated;
grant all on public.cos_weather_hourly, public.cos_slot_models, public.cos_agenda_plans to service_role;

-- Las historias de clima usan campaign 'clima:<día>' y source 'sistema' (como las de feriado):
-- no hace falta cambiar nada más.

-- ============================================================================
-- Content OS — F7 Motor de gustos · M0: fichas y registro
-- (.gauntlet/features/f7-motor-gustos/spec.md)
--
-- · cos_music_tracks: un tema = una fila con id estable (antes eran archivos sueltos en
--   cos-media/music/<marca>/). Ficha automática (duración, BPM, energía: job music:analyze) y a
--   mano (género, mood, voz). Un tema que se saca de la biblioteca NO se borra: queda
--   active = false, porque los posts que lo usaron siguen enseñando.
-- · cos_posts.music_track_id: el tema exacto de cada post. Lo completa la base sola a partir de
--   music_key (trigger), así ningún camino que escriba music_key se olvida. NO entra en el
--   hash de aprobación: no devuelve nada a aprobación.
-- · cos_posts.pick_json: el porqué de cada elección del motor (lo usa M2).
-- · cos_assets.traits / cos_media.traits: rasgos de imagen con vocabulario cerrado
--   (shared/cos/gustos.ts). En cos_media porque lo publicado es de donde se aprende: casi todo
--   el histórico está ahí y no en cos_assets.
-- · cos_taste_models y cos_suggestions: se crean ahora para no migrar otra vez en M1/M3.
--
-- Los vocabularios de los CHECK son copia de shared/cos/gustos.ts: un test verifica que sean
-- idénticos. Si se cambia uno, se cambian los dos.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Temas de música
-- ---------------------------------------------------------------------------
create table public.cos_music_tracks (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.cos_brands(id) on delete restrict,
  storage_key     text not null unique check (storage_key ~ '^music/[a-z0-9-]+/[^/]+$'),
  title           text not null,
  duration_s      numeric check (duration_s >= 0),
  bpm             numeric check (bpm between 30 and 300),
  bpm_confidence  numeric check (bpm_confidence between 0 and 1),
  energy          numeric check (energy between 0 and 1),
  genre           text check (genre in ('house', 'jazz', 'lounge', 'lofi', 'urbano', 'oriental', 'pop', 'otro')),
  mood            text[] not null default '{}'
                    check (mood <@ array['relajado', 'arriba', 'elegante', 'divertido', 'romantico']::text[]),
  vocals          boolean,                              -- true con voz · false instrumental · null sin marcar
  source_url      text,
  license         text,
  active          boolean not null default true,        -- false = sacado de la biblioteca (el archivo ya no está)
  analyzed_at     timestamptz,
  analysis_error  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index cos_music_tracks_brand on public.cos_music_tracks (brand_id, active);
create trigger cos_music_tracks_touch before update on public.cos_music_tracks
  for each row execute function public.cos_touch_updated_at();

-- La marca del tema es la de su carpeta: un tema no puede quedar en la biblioteca de otra.
create or replace function public.cos_music_tracks_brand_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1 from public.cos_brands b
    where b.id = new.brand_id and new.storage_key like 'music/' || b.slug || '/%'
  ) then
    raise exception 'cos: el tema % no está en la carpeta de su marca', new.storage_key
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger cos_music_tracks_brand_guard before insert or update of brand_id, storage_key on public.cos_music_tracks
  for each row execute function public.cos_music_tracks_brand_guard();

-- ---------------------------------------------------------------------------
-- Post ↔ tema
-- ---------------------------------------------------------------------------
alter table public.cos_posts
  add column music_track_id uuid references public.cos_music_tracks(id) on delete set null,
  add column pick_json      jsonb;
create index cos_posts_music_track on public.cos_posts (music_track_id) where music_track_id is not null;

-- El tema sale de music_key: una sola fuente, escriba quien escriba.
create or replace function public.cos_posts_music_track()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.music_key is distinct from old.music_key then
    new.music_track_id := (select t.id from public.cos_music_tracks t where t.storage_key = new.music_key);
  end if;
  return new;
end $$;
create trigger cos_posts_music_track before insert or update of music_key on public.cos_posts
  for each row execute function public.cos_posts_music_track();

-- Un tema que se registra tarde (la sincronización corre después de la subida) se vincula a
-- los posts que ya lo usaban. music_track_id no es contenido: no toca la aprobación.
create or replace function public.cos_music_tracks_link_posts()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.cos_posts set music_track_id = new.id
   where music_key = new.storage_key and music_track_id is distinct from new.id;
  return null;
end $$;
create trigger cos_music_tracks_link_posts after insert on public.cos_music_tracks
  for each row execute function public.cos_music_tracks_link_posts();

-- ---------------------------------------------------------------------------
-- Rasgos de imagen / video
-- ---------------------------------------------------------------------------
alter table public.cos_assets
  add column traits         jsonb,
  add column traits_version smallint,
  add column traits_error   text;

alter table public.cos_media
  add column traits         jsonb,
  add column traits_version smallint,
  add column traits_error   text;
create index cos_media_traits_pending on public.cos_media (posted_at desc) where traits_version is null;

-- Tope de gasto del backfill de rasgos (traits:backfill), en dólares. Se cambia acá, sin código.
alter table public.cos_settings
  add column traits_backfill_max_usd numeric(8, 2) not null default 15 check (traits_backfill_max_usd >= 0);

-- ---------------------------------------------------------------------------
-- Modelos aprendidos (M1) y sugerencias (M3)
-- ---------------------------------------------------------------------------
create table public.cos_taste_models (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.cos_brands(id) on delete cascade,
  format        text not null check (format in ('feed', 'reel', 'story', 'carousel', 'video')),
  objective     text not null default 'gusta' check (objective in ('gusta', 'crece', 'conversa', 'vende')),
  model_version int not null default 1,
  n             int not null check (n >= 0),
  model_json    jsonb not null,
  computed_at   timestamptz not null default now()
);
create index cos_taste_models_latest on public.cos_taste_models (brand_id, format, objective, computed_at desc);

create table public.cos_suggestions (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.cos_brands(id) on delete cascade,
  week        date not null,                         -- lunes de la semana (Buenos Aires)
  kind        text not null check (kind in ('contenido', 'material', 'musica', 'pauta')),
  items_json  jsonb not null default '[]'::jsonb,
  feedback    text check (feedback in ('util', 'no_util')),
  feedback_at timestamptz,
  feedback_by uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (brand_id, week, kind)                      -- el job semanal no duplica
);

-- ---------------------------------------------------------------------------
-- RLS y permisos: lectura para miembros, escritura solo del servidor/worker.
-- ---------------------------------------------------------------------------
alter table public.cos_music_tracks enable row level security;
alter table public.cos_taste_models enable row level security;
alter table public.cos_suggestions  enable row level security;
create policy cos_music_tracks_read on public.cos_music_tracks for select to authenticated using (public.cos_is_member());
create policy cos_taste_models_read on public.cos_taste_models for select to authenticated using (public.cos_is_member());
create policy cos_suggestions_read  on public.cos_suggestions  for select to authenticated using (public.cos_is_member());

revoke all on public.cos_music_tracks, public.cos_taste_models, public.cos_suggestions from anon, authenticated;
grant select on public.cos_music_tracks, public.cos_taste_models, public.cos_suggestions to authenticated;
grant all on public.cos_music_tracks, public.cos_taste_models, public.cos_suggestions to service_role;

revoke execute on function
  public.cos_posts_music_track(), public.cos_music_tracks_link_posts(), public.cos_music_tracks_brand_guard()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: un tema por cada archivo que hoy está en cos-media/music/<marca>/.
-- En Supabase el listado del bucket está en storage.objects; en la base de pruebas no existe
-- y el job music:sync del worker hace lo mismo (es idempotente: se puede correr siempre).
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $q$
      insert into public.cos_music_tracks (brand_id, storage_key, title)
      select b.id, o.name,
             coalesce(nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
               split_part(o.name, '/', 3), '\.[^.]+$', ''), '[-_]+', ' ', 'g'), '\s+[0-9a-fA-F]{6}$', '')), ''), 'tema')
      from storage.objects o
      join public.cos_brands b on b.slug = split_part(o.name, '/', 2)
      where o.bucket_id = 'cos-media'
        and o.name ~* '^music/[a-z0-9-]+/[^/]+\.(mp3|m4a|wav|aac)$'
      on conflict (storage_key) do nothing
    $q$;
  end if;
end $$;

-- Los posts que ya tenían música quedan vinculados a su tema.
update public.cos_posts p set music_track_id = t.id
from public.cos_music_tracks t
where t.storage_key = p.music_key and p.music_track_id is distinct from t.id;

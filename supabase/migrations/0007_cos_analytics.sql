-- ============================================================================
-- Content OS — F1 Analytics (.gauntlet/features/f1-analytics/spec.md)
--
-- · cos_media: TODO lo publicado en cada cuenta (hecho por Content OS o no), con su formato,
--   fecha y una miniatura propia (las URLs de Meta vencen).
-- · cos_media_metrics: fotos de las métricas en el tiempo (no solo el último valor).
-- · cos_account_daily: seguidores de cada cuenta, una foto por día (Meta no da el histórico).
-- Lo escribe solo el worker (service role). Se lee con cos_is_member().
-- ============================================================================

create table public.cos_media (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.cos_social_accounts(id) on delete cascade,
  brand_id        uuid not null references public.cos_brands(id) on delete cascade,
  platform        text not null check (platform in ('instagram', 'facebook')),
  remote_id       text not null,
  format          text not null check (format in ('feed', 'reel', 'story', 'carousel', 'video')),
  caption         text,
  permalink       text,
  posted_at       timestamptz not null,
  thumb_key       text,                         -- miniatura propia en cos-media
  post_id         uuid references public.cos_posts(id) on delete set null,  -- si la publicó Content OS
  metrics         jsonb not null default '{}'::jsonb,   -- último valor (desnormalizado para listar rápido)
  metrics_at      timestamptz,
  metrics_error   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (platform, remote_id)
);
create index cos_media_account_posted on public.cos_media (account_id, posted_at desc);
create index cos_media_brand_posted on public.cos_media (brand_id, posted_at desc);
create trigger cos_media_touch before update on public.cos_media
  for each row execute function public.cos_touch_updated_at();

create table public.cos_media_metrics (
  id          bigint generated always as identity primary key,
  media_id    uuid not null references public.cos_media(id) on delete cascade,
  captured_at timestamptz not null default now(),
  age_hours   numeric not null,                 -- edad del post al medir (velocidad de crecimiento)
  data        jsonb not null,                   -- {reach, views, likes, comments, saved, shares, …}
  -- Una sola foto por post y por hora: un reintento no duplica.
  captured_hour timestamp generated always as (date_trunc('hour', captured_at at time zone 'UTC')) stored,
  unique (media_id, captured_hour)
);
create index cos_media_metrics_media on public.cos_media_metrics (media_id, captured_at);

create table public.cos_account_daily (
  account_id  uuid not null references public.cos_social_accounts(id) on delete cascade,
  day         date not null,
  followers   int,
  media_count int,
  primary key (account_id, day)
);

-- Estado de la recolección por cuenta (para reanudar el histórico y mostrar salud).
alter table public.cos_social_accounts
  add column metrics_backfill_cursor text,       -- página siguiente del histórico (null = terminado)
  add column metrics_backfill_done   boolean not null default false,
  add column metrics_synced_at       timestamptz,
  add column metrics_error           text;

alter table public.cos_media         enable row level security;
alter table public.cos_media_metrics enable row level security;
alter table public.cos_account_daily enable row level security;
create policy cos_media_read         on public.cos_media         for select to authenticated using (public.cos_is_member());
create policy cos_media_metrics_read on public.cos_media_metrics for select to authenticated using (public.cos_is_member());
create policy cos_account_daily_read on public.cos_account_daily for select to authenticated using (public.cos_is_member());

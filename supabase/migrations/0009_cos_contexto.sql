-- ============================================================================
-- Content OS — F4 Contexto: feriados, fechas especiales y clima
-- (.gauntlet/features/f4-contexto/spec.md)
-- ============================================================================

create table public.cos_special_days (
  id          uuid primary key default gen_random_uuid(),
  day         date not null,
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  kind        text not null check (kind in ('feriado', 'puente', 'especial', 'marca', 'evento')),
  brand_id    uuid references public.cos_brands(id) on delete cascade,   -- null = vale para todas
  source      text not null check (source in ('argentinadatos', 'curado', 'manual')),
  hint        text,                                                       -- idea de contenido
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
-- Una misma fecha con el mismo nombre no se repite (para todas o para una marca).
create unique index cos_special_days_unique
  on public.cos_special_days (day, name, coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index cos_special_days_day on public.cos_special_days (day);

create table public.cos_weather_daily (
  day         date primary key,                -- Buenos Aires
  code        int not null,                    -- código WMO (Open-Meteo)
  tmax        numeric,
  tmin        numeric,
  rain_prob   int,
  updated_at  timestamptz not null default now()
);

alter table public.cos_special_days  enable row level security;
alter table public.cos_weather_daily enable row level security;
create policy cos_special_days_read  on public.cos_special_days  for select to authenticated using (public.cos_is_member());
create policy cos_weather_daily_read on public.cos_weather_daily for select to authenticated using (public.cos_is_member());

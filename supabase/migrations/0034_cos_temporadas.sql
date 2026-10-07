-- ============================================================================
-- Content OS — Agenda a 3 meses y campañas por temporada (07-10-2026)
--
-- Javier: "deberíamos poder programar 3 meses, que es una estación, una época del año, así
-- desarrollamos campañas publicitarias basadas en ese tiempo".
--
-- cos_brands.ritmo   {postsSemana, historiasDia} por cuenta. Decisión: 5 por semana, 3 historias/día.
-- cos_campaigns      campañas de la marca con fechas: temporadas (estaciones), fechas comerciales y
--                    las propias. La IA usa la vigente (y la próxima) al escribir; el calendario las
--                    muestra como franjas. Base para los anuncios después.
-- ============================================================================

alter table public.cos_brands add column ritmo jsonb not null default '{"postsSemana": 5, "historiasDia": 3}';

create table public.cos_campaigns (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.cos_brands(id) on delete cascade,
  nombre     text not null check (char_length(btrim(nombre)) between 1 and 80),
  tipo       text not null default 'propia' check (tipo in ('temporada', 'comercial', 'propia')),
  desde      date not null,
  hasta      date not null,
  objetivo   text not null default '',   -- qué queremos lograr (ej. que pidan para compartir)
  mensaje    text not null default '',   -- la idea que se repite en todas las piezas
  productos  text not null default '',   -- productos o combos foco
  tono       text not null default '',   -- cómo suena (ej. más festivo, más cálido)
  color      text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  activa     boolean not null default true,
  created_at timestamptz not null default now(),
  check (hasta >= desde)
);
create index cos_campaigns_brand on public.cos_campaigns (brand_id, desde);
alter table public.cos_campaigns enable row level security;
create policy cos_campaigns_read on public.cos_campaigns for select to authenticated using (public.cos_is_member());

-- Estaciones (hemisferio sur) y fechas comerciales de Argentina, para cada marca activa. El mensaje
-- queda vacío: lo completa Javier (la IA igual usa el nombre y las fechas).
insert into public.cos_campaigns (brand_id, nombre, tipo, desde, hasta, color)
select b.id, c.nombre, c.tipo, c.desde::date, c.hasta::date, c.color
from public.cos_brands b
cross join (values
  ('Primavera',             'temporada', '2026-09-21', '2026-12-20', '#22c55e'),
  ('Verano',                'temporada', '2026-12-21', '2027-03-20', '#f59e0b'),
  ('Otoño',                 'temporada', '2027-03-21', '2027-06-20', '#c2410c'),
  ('Invierno',              'temporada', '2027-06-21', '2027-09-20', '#3b82f6'),
  ('Día de la Madre',       'comercial', '2026-10-09', '2026-10-18', '#ec4899'),
  ('Black Friday',          'comercial', '2026-11-23', '2026-11-30', '#111827'),
  ('Navidad',               'comercial', '2026-12-14', '2026-12-24', '#dc2626'),
  ('Fin de año',            'comercial', '2026-12-26', '2026-12-31', '#a855f7'),
  ('San Valentín',          'comercial', '2027-02-07', '2027-02-14', '#e11d48'),
  ('Día del Padre',         'comercial', '2027-06-11', '2027-06-20', '#0ea5e9'),
  ('Día del Amigo',         'comercial', '2027-07-13', '2027-07-20', '#14b8a6')
) as c(nombre, tipo, desde, hasta, color)
where b.active;

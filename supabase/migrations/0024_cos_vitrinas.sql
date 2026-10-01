-- ============================================================================
-- Content OS — F11 Motor de Vitrinas (docs/PLAN-MOTOR-VITRINAS.md)
--
-- Una vitrina es una web pública (sin login, noindex) con los anuncios de una tanda en teléfonos,
-- su texto y un botón «Compartir en Instagram». Se arma desde una campaña de Meta o sola cuando el
-- Motor de ADS deja una tanda creada (F10 E4). La sirve la app en vitrina.kitchcocenter.com:
--   /<marca>/          → la vigente de la marca (link fijo)
--   /<marca>/<slug>/   → una vitrina puntual. Retirada = redirige a la vigente (ningún link muere).
--
-- Decisiones de Javier (01-10): 6 por marca, la historia de Turnos sale al APROBAR, se comparte el
-- video (y «Ver en Instagram» si el anuncio tiene publicación), compartidos por empleado si entra
-- desde Turnos (?e=<token opaco>) y anónimos si no.
-- ============================================================================

alter table public.cos_brands add column vitrinas_max int not null default 6 check (vitrinas_max between 1 and 20);

create table public.cos_vitrinas (
  id                 uuid primary key default gen_random_uuid(),
  brand_id           uuid not null references public.cos_brands(id) on delete cascade,
  -- Impredecible (no se adivina la de otra marca o la próxima).
  slug               text not null unique check (slug ~ '^[a-z0-9-]{6,80}$'),
  titulo             text not null default '',
  bajada             text not null default '',
  estado             text not null default 'armando'
                     check (estado in ('armando', 'lista', 'aprobada', 'retirada', 'error')),
  origen             text not null check (origen in ('campaña', 'motor')),
  meta_campaign_id   text,
  proposal_week      date,
  error              text,
  approved_by        uuid,
  approved_at        timestamptz,
  retired_at         timestamptz,
  -- V2: cuándo se avisó al equipo en Turnos (historia).
  turnos_at          timestamptz,
  turnos_error       text,
  -- A quién le llegó: { token: nombre } (el token va en el link de cada uno → compartidos por persona).
  turnos_gente       jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index cos_vitrinas_brand_idx on public.cos_vitrinas (brand_id, created_at desc);
-- Una sola vitrina por campaña y marca (re-armar = la misma fila).
create unique index cos_vitrinas_campaign_uq on public.cos_vitrinas (brand_id, meta_campaign_id)
  where meta_campaign_id is not null and estado <> 'retirada';

create table public.cos_vitrina_items (
  id                 uuid primary key default gen_random_uuid(),
  vitrina_id         uuid not null references public.cos_vitrinas(id) on delete cascade,
  orden              int not null default 0,
  ad_id              text references public.cos_ads(id) on delete set null,
  nombre             text not null default '',
  titulo             text not null default '',
  cuerpo             text not null default '',
  chip               text,
  cta                text,
  mensaje_wa         text,
  -- cos-media: video liviano para mirar, versión para compartir (720p) y portada.
  video_key          text,
  share_key          text,
  poster_key         text,
  -- Publicación de Instagram del anuncio (para repostear el original con la marca etiquetada).
  permalink          text,
  origen_ia          boolean not null default false,
  created_at         timestamptz not null default now()
);
create index cos_vitrina_items_vitrina_idx on public.cos_vitrina_items (vitrina_id, orden);

create table public.cos_vitrina_events (
  id                 bigint generated always as identity primary key,
  vitrina_id         uuid not null references public.cos_vitrinas(id) on delete cascade,
  item_id            uuid references public.cos_vitrina_items(id) on delete cascade,
  tipo               text not null check (tipo in ('vista', 'compartir', 'descarga', 'ver_ig')),
  -- Token opaco del empleado cuando entra desde Turnos; null = anónimo.
  empleado           text check (empleado is null or empleado ~ '^[A-Za-z0-9_-]{4,80}$'),
  created_at         timestamptz not null default now()
);
create index cos_vitrina_events_idx on public.cos_vitrina_events (vitrina_id, item_id, tipo);

alter table public.cos_vitrinas       enable row level security;
alter table public.cos_vitrina_items  enable row level security;
alter table public.cos_vitrina_events enable row level security;
create policy cos_vitrinas_read       on public.cos_vitrinas       for select to authenticated using (public.cos_is_member());
create policy cos_vitrina_items_read  on public.cos_vitrina_items  for select to authenticated using (public.cos_is_member());
create policy cos_vitrina_events_read on public.cos_vitrina_events for select to authenticated using (public.cos_is_member());
revoke all on public.cos_vitrinas, public.cos_vitrina_items, public.cos_vitrina_events from anon, authenticated;
grant select on public.cos_vitrinas, public.cos_vitrina_items, public.cos_vitrina_events to authenticated;
grant all on public.cos_vitrinas, public.cos_vitrina_items, public.cos_vitrina_events to service_role;

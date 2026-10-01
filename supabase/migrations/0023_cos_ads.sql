-- ============================================================================
-- Content OS — F10 Motor de ADS (docs/PLAN-MOTOR-ADS.md)
--
-- Una vez por semana, por marca, el motor propone anuncios armados a partir de lo que ya
-- funcionó (anuncios de Meta y publicaciones orgánicas con sus números). Javier aprueba y el
-- motor los crea en Meta PAUSADOS. Nunca prende nada ni sube presupuestos de lo que corre.
--
--   cos_ad_accounts     cuentas publicitarias que se leen (el token va por variable de entorno:
--                       acá solo el NOMBRE de la variable, como en cos_social_accounts)
--   cos_ads             cada anuncio con su creativo, conjunto (público, presupuesto) y totales.
--                       La marca sale de la PÁGINA del anuncio, no de la cuenta: en «Live Javi»
--                       corren los de Sensaciones. Una marca nueva entra sola al conectar su página.
--   cos_ad_daily        insights por anuncio y día (level=ad, time_increment=1). El costo por
--                       conversación viene de cost_per_action_type: nunca se calcula a mano.
--   cos_ad_brand_daily  el resumen diario por marca que juntó el Scheduler desde dic-2025
--                       (import único: scripts/importar-scheduler.mjs) + ventas CAPI por día.
--   cos_ad_proposals    la tanda semanal: propuestas que Javier aprueba, edita o descarta.
-- ============================================================================

create table public.cos_ad_accounts (
  id                 text primary key check (id ~ '^act_[0-9]+$'),
  name               text,
  currency           text,
  timezone           text,
  token_ref          text not null default 'META_ADS_TOKEN',
  active             boolean not null default true,
  -- Hasta qué día quedó completo el backfill de insights (se avanza mes a mes).
  insights_until     date,
  synced_at          timestamptz,
  last_error         text,
  created_at         timestamptz not null default now()
);

create table public.cos_ads (
  id                 text primary key,
  ad_account_id      text not null references public.cos_ad_accounts(id) on delete cascade,
  brand_id           uuid references public.cos_brands(id) on delete set null,
  page_id            text,
  ig_user_id         text,
  name               text,
  status             text,
  effective_status   text,
  created_time       timestamptz,
  campaign_id        text,
  campaign_name      text,
  objective          text,
  adset_id           text,
  adset_name         text,
  -- En la moneda de la cuenta (Meta lo da en centavos: se divide por 100 al guardar).
  daily_budget       numeric,
  lifetime_budget    numeric,
  optimization_goal  text,
  destination_type   text,
  targeting          jsonb,
  creative_id        text,
  -- video | imagen | post (publicación existente) | carrusel | otro
  creative_kind      text,
  object_type        text,
  title              text,
  body               text,
  cta_type           text,
  cta_value          jsonb,
  welcome_message    text,
  video_id           text,
  image_hash         text,
  image_url          text,
  story_id           text,
  ig_media_id        text,
  permalink          text,
  -- Copias propias (los links de Meta vencen): miniatura siempre; video solo de los rankeados.
  thumb_key          text,
  video_key          text,
  media_error        text,
  -- Número que le puso el Scheduler (Javier los nombra así: «el 313»).
  scheduler_number   int,
  -- Totales del período (insights agregados de la API, con cost_per_action_type).
  totals             jsonb not null default '{}'::jsonb,
  first_date         date,
  last_date          date,
  -- Filtro de seguridad (IA): precio quemado, «sin TACC», promo vencida… y cuadros limpios.
  revision           jsonb,
  revision_version   int,
  revision_at        timestamptz,
  -- E5: si lo creó el motor, de qué propuesta salió.
  proposal_id        uuid,
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);
create index cos_ads_brand_idx on public.cos_ads (brand_id, last_date desc);
create index cos_ads_page_idx on public.cos_ads (page_id);
create index cos_ads_proposal_idx on public.cos_ads (proposal_id) where proposal_id is not null;

create table public.cos_ad_daily (
  ad_id                  text not null references public.cos_ads(id) on delete cascade,
  date                   date not null,
  spend                  numeric not null default 0,
  impressions            int not null default 0,
  reach                  int not null default 0,
  clicks                 int not null default 0,
  link_clicks            int not null default 0,
  conversations          int not null default 0,
  first_replies          int not null default 0,
  cost_per_conversation  numeric,
  actions                jsonb,
  primary key (ad_id, date)
);
create index cos_ad_daily_date_idx on public.cos_ad_daily (date);

create table public.cos_ad_brand_daily (
  label              text not null,           -- marca como la nombra el Scheduler
  date               date not null,
  ad_account_id      text,
  brand_id           uuid references public.cos_brands(id) on delete set null,
  spend              numeric,
  messages           int,
  cost_per_message   numeric,
  first_replies      int,
  clicks             int,
  reach              int,
  impressions        int,
  purchases          int,
  purchase_value     numeric,
  data               jsonb,
  imported_at        timestamptz not null default now(),
  primary key (label, date)
);

create table public.cos_ad_proposals (
  id                 uuid primary key default gen_random_uuid(),
  brand_id           uuid not null references public.cos_brands(id) on delete cascade,
  week               date not null,
  -- reusar: el ganador tal cual con texto nuevo · reeditar: otra apertura + placa final actual
  -- organico: pautar un post que rindió · variante: el mismo diseño, texto sobre otro producto
  kind               text not null check (kind in ('reusar', 'reeditar', 'organico', 'variante')),
  status             text not null default 'propuesta'
                     check (status in ('preparando', 'propuesta', 'aprobada', 'creando', 'creada', 'descartada', 'error')),
  source_ad_id       text references public.cos_ads(id) on delete set null,
  source_media_id    uuid references public.cos_media(id) on delete set null,
  -- La clave de la fuente (para no proponer dos veces lo mismo en la semana).
  source_key         text not null,
  ad_account_id      text references public.cos_ad_accounts(id) on delete set null,
  -- Conjunto de anuncios que se copia (público, ubicaciones, optimización): el del ganador.
  template_adset_id  text,
  title              text not null default '',
  body               text not null default '',
  cta_type           text,
  daily_budget       numeric,
  por_que            text not null default '',
  numeros            jsonb not null default '{}'::jsonb,
  -- [{ formato: '9x16'|'4x5'|'original', tipo: 'video'|'imagen', key, meta_video_id?, meta_image_hash? }]
  pieces             jsonb not null default '[]'::jsonb,
  -- Lo que se va creando en Meta, paso a paso (reintentos idempotentes): adset/creative/ad ids.
  meta               jsonb not null default '{}'::jsonb,
  error              text,
  approved_by        uuid,
  approved_at        timestamptz,
  created_in_meta_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (brand_id, week, kind, source_key)
);
create index cos_ad_proposals_brand_idx on public.cos_ad_proposals (brand_id, week desc);

alter table public.cos_ads add constraint cos_ads_proposal_fk
  foreign key (proposal_id) references public.cos_ad_proposals(id) on delete set null;

-- Cuentas que se leen. La marca NO va acá (sale de la página de cada anuncio).
insert into public.cos_ad_accounts (id, name) values
  ('act_895683101580966',   'Bijutsukan Sushi'),
  ('act_1256744382449184',  'Sensaciones de Oriente'),
  ('act_1493524865759729',  'Fasutofudovege'),
  ('act_1574878906967403',  'StohrBurgers'),
  ('act_10151277252895948', 'Live Javi'),
  ('act_4990452127668612',  'Cualquiera Cocina'),
  ('act_977030458136925',   'Kitchcosoluciones')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS: los miembros leen; escribe solo el servidor (service_role) — las acciones de la web
-- verifican el rol antes (requireMember), como en el resto de Content OS.
-- ---------------------------------------------------------------------------
alter table public.cos_ad_accounts    enable row level security;
alter table public.cos_ads            enable row level security;
alter table public.cos_ad_daily       enable row level security;
alter table public.cos_ad_brand_daily enable row level security;
alter table public.cos_ad_proposals   enable row level security;
create policy cos_ad_accounts_read    on public.cos_ad_accounts    for select to authenticated using (public.cos_is_member());
create policy cos_ads_read            on public.cos_ads            for select to authenticated using (public.cos_is_member());
create policy cos_ad_daily_read       on public.cos_ad_daily       for select to authenticated using (public.cos_is_member());
create policy cos_ad_brand_daily_read on public.cos_ad_brand_daily for select to authenticated using (public.cos_is_member());
create policy cos_ad_proposals_read   on public.cos_ad_proposals   for select to authenticated using (public.cos_is_member());
revoke all on public.cos_ad_accounts, public.cos_ads, public.cos_ad_daily, public.cos_ad_brand_daily, public.cos_ad_proposals from anon, authenticated;
grant select on public.cos_ad_accounts, public.cos_ads, public.cos_ad_daily, public.cos_ad_brand_daily, public.cos_ad_proposals to authenticated;
grant all on public.cos_ad_accounts, public.cos_ads, public.cos_ad_daily, public.cos_ad_brand_daily, public.cos_ad_proposals to service_role;

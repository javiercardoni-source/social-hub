-- ============================================================================
-- Content OS — Insumos de los motores visuales (Marca → Motores) y regla del clima
--
-- cos_brand_assets: lo que cada marca le da a los motores.
--   referencia   video o placa de estilo → la IA arma una "ficha de estilo" (analysis)
--   fuente_titulo / fuente_texto  tipografía exacta (TTF/OTF/WOFF); si no hay, se usa la actual
--   logo         PNG con fondo transparente
-- La música sigue en cos-media/music/<marca>/ (una carpeta por marca = su biblioteca).
--
-- cos_posts.uses_weather: el borrador menciona el clima. Sirve para la regla "como mucho una
-- vez por día por marca" (y solo si el clima cambió respecto de ayer).
-- ============================================================================

alter table public.cos_posts add column uses_weather boolean not null default false;

create table public.cos_brand_assets (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.cos_brands(id) on delete cascade,
  kind        text not null check (kind in ('referencia', 'fuente_titulo', 'fuente_texto', 'logo')),
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  storage_key text not null,
  mime        text not null,
  size_bytes  bigint,
  note        text,                                  -- qué le gusta de esta referencia (opcional)
  status      text not null default 'lista' check (status in ('analizando', 'lista', 'error')),
  analysis    jsonb,                                 -- ficha de estilo (solo referencias)
  error       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index cos_brand_assets_brand on public.cos_brand_assets (brand_id, kind, created_at desc);
-- Una sola tipografía de título, una de texto y un logo vigentes por marca.
create unique index cos_brand_assets_unico on public.cos_brand_assets (brand_id, kind) where kind <> 'referencia';

alter table public.cos_brand_assets enable row level security;
create policy cos_brand_assets_read on public.cos_brand_assets for select to authenticated using (public.cos_is_member());

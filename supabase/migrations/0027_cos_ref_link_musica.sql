-- ============================================================================
-- Content OS — Referencias desde un link + qué música buscar (06-10-2026)
--
-- · cos_brand_assets.source_url / link_meta: la referencia se cargó pegando un link (CapCut trae la
--   duración EXACTA de cada toma: link_meta.tomas / link_meta.cortes).
-- · cos_brands.musica_recomendada: qué música conviene buscar, según el ritmo y la energía MEDIDOS en
--   las referencias de Reels de la marca (y su estilo visual). La arma el worker (musica:recomendar).
-- ============================================================================

alter table public.cos_brand_assets
  add column source_url text check (source_url is null or source_url ~ '^https://'),
  add column link_meta  jsonb;

alter table public.cos_brands
  add column musica_recomendada    jsonb,
  add column musica_recomendada_at timestamptz;

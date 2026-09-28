-- ============================================================================
-- Content OS — F2 Archivo: el material que ya existe (carpetas del Mac, lo publicado en IG)
--
-- Entra a la Biblioteca como "archivo": la IA lo analiza de a poco (describe, clasifica,
-- puntúa) y Javier decide qué se usa. No arma borradores solo: se arman cuando se elige "Usar".
-- ============================================================================

alter table public.cos_assets drop constraint cos_assets_source_check;
alter table public.cos_assets add constraint cos_assets_source_check
  check (source in ('turnos', 'manual', 'drive', 'archivo', 'instagram'));

alter table public.cos_assets
  -- null = no es de archivo · pending = falta revisar · approved = se puede usar · discarded = no
  add column review_status  text check (review_status in ('pending', 'approved', 'discarded')),
  add column origin_path    text,          -- carpeta/archivo de origen o link al post original
  add column origin_media_id uuid references public.cos_media(id) on delete set null,
  add column description_by_ai boolean not null default false;

create index cos_assets_archivo on public.cos_assets (brand_id, review_status, created_at desc)
  where review_status is not null;

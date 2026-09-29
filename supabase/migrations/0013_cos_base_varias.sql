-- ============================================================================
-- Content OS — Base de fotos: varias carpetas por marca y repetidos por contenido
--
-- base_folders: [{ id, name }] — todas las carpetas de Drive de la marca. Si está vacío se
-- usa base_folder_id (o Content OS/00_BASE/<marca>).
-- origin_md5: huella del archivo en Drive. La misma foto copiada en otra carpeta (o con
-- otro nombre, "- copia", "(1)") se trae una sola vez, aunque llegue en otra tanda.
-- ============================================================================

alter table public.cos_brands add column base_folders jsonb not null default '[]'::jsonb;
alter table public.cos_assets add column origin_md5 text;
create index cos_assets_origin_md5 on public.cos_assets (brand_id, origin_md5) where origin_md5 is not null;

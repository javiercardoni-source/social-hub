-- ============================================================================
-- Content OS — Base de fotos en Drive (carga masiva de material histórico)
--
-- Cada marca tiene su carpeta de Drive ("base de fotos"). El botón «Traer desde base de
-- fotos» trae una tanda (25/50/100/200) al Archivo; la IA analiza solo esa tanda.
-- El sistema solo LEE esa carpeta: nunca mueve ni borra nada. Lo ya traído se reconoce por
-- cos_assets.source = 'drive' + source_external_id = id del archivo en Drive.
-- ============================================================================

alter table public.cos_brands
  add column base_folder_id   text,   -- null = se usa (y se crea) Content OS/00_BASE/<marca>
  add column base_folder_name text,
  -- Última tanda: { at, pedidos, total, ya_traidos, quedan, salteados, error }
  add column base_estado      jsonb;

-- Lo ya traído lo protege la clave única existente cos_assets (source, source_external_id).

-- ============================================================================
-- Content OS — F6 Vista del feed + estilo de grilla
--
-- cos_brands.grid_style: regla por columna del perfil { columnas: [izq, centro, der] } con
--   'con_texto' | 'sin_texto' | 'libre' (shared/cos/grilla.ts).
-- cos_brands.feed_analisis: último análisis de la grilla hecho por la IA (feed:analyze).
-- cos_media.con_texto: si una publicación ya hecha lleva texto encima (lo dice la IA al mirar
--   la grilla; null = no se sabe).
-- ============================================================================

alter table public.cos_brands
  add column grid_style        jsonb,
  add column feed_analisis     jsonb,
  add column feed_analisis_at  timestamptz;

alter table public.cos_media add column con_texto boolean;

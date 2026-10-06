-- ============================================================================
-- Content OS — Partes de un video que no se usan (06-10-2026)
--
-- Javier marca en Aprobaciones (Video original) los tramos de un video que no quiere que el motor
-- use (una mano que tapa, algo fuera de foco, un cliente). Quedan en la versión del archivo:
-- todos los reels que salgan de ese video las evitan. [[desde, hasta], …] en segundos.
-- ============================================================================

alter table public.cos_asset_versions add column excluir jsonb not null default '[]';

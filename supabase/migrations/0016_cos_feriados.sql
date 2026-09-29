-- ============================================================================
-- Content OS — Historias de feriado
--
-- campaign: los borradores que arma el sistema solo (ej. "feriado:2026-11-23:1"). Una sola vez
-- por marca y campaña: si Javier la rechaza, no se vuelve a crear.
-- source 'sistema': placas de fondo que genera Social Hub (historia sin foto buena). No se
-- muestran en la Biblioteca.
-- ============================================================================

alter table public.cos_posts add column campaign text;
create unique index cos_posts_campaign on public.cos_posts (brand_id, campaign) where campaign is not null;

alter table public.cos_assets drop constraint cos_assets_source_check;
alter table public.cos_assets add constraint cos_assets_source_check
  check (source in ('turnos', 'manual', 'drive', 'archivo', 'instagram', 'sistema'));

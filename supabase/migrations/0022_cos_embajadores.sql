-- ============================================================================
-- Content OS — Programa Embajadores (F4B, docs/embajadores/CONTRATO-CONTENT-OS.md)
--
-- LoyalEngine manda material ya aprobado por Javier y con permiso de imagen dado
-- (amb_participants.image_rights_ok). El vínculo entre las dos bases (sin claves
-- cruzadas) es source = 'embajadores' + source_external_id = 'amb:<submission_id>'.
--
-- embajador_scored_at: cuándo se le avisó el quality_score a LoyalEngine (POST
-- .../content/score) después de asset:classify. Si es NULL y ya hay quality_score,
-- el próximo ciclo de ingest:embajadores reintenta (ver worker/src/embajadores.ts).
-- No hace falta para nada más: no es una columna de negocio, solo bookkeeping.
-- ============================================================================

alter table public.cos_assets drop constraint cos_assets_source_check;
alter table public.cos_assets add constraint cos_assets_source_check
  check (source in ('turnos', 'manual', 'drive', 'archivo', 'instagram', 'sistema', 'embajadores'));

alter table public.cos_assets add column embajador_scored_at timestamptz;

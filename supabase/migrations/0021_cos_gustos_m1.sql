-- ============================================================================
-- Content OS — F7 Motor de gustos · M1
--
-- cos_media.pautado: una publicación promocionada con Ads infla el alcance y no puede enseñarle
-- al motor orgánico (spec F7 «La realidad que manda» 7). La API no dice de forma confiable qué se
-- pautó: se marca a mano (y más adelante desde Meta Ads). Lo pautado se excluye de taste:learn.
-- ============================================================================

alter table public.cos_media add column pautado boolean not null default false;

-- ============================================================================
-- Content OS — Por qué se rechaza un post (05-10-2026)
--
-- Javier: «que cuando rechazo me pregunte por qué, para que el motor mejore». Al rechazar se eligen
-- motivos (chips) y/o una explicación libre. Los últimos rechazos de cada marca le llegan a la IA
-- como «lecciones» (shared/cos/rechazos.ts) en cada texto, guion y frase que escribe.
-- ============================================================================

alter table public.cos_posts
  add column reject_reasons text[] not null default '{}',
  add column reject_note    text check (reject_note is null or char_length(reject_note) <= 500),
  add column rejected_at    timestamptz,
  add column rejected_by    uuid;

create index cos_posts_rechazos_idx on public.cos_posts (brand_id, rejected_at desc) where rejected_at is not null;

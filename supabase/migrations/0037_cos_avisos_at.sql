-- 07-10-2026 · Cuándo se controlaron por última vez los textos de la pieza (ingredientes). null = nunca:
-- el trabajo horario `ingredientes:revisar` toma las pendientes con null, las controla y marca la fecha.
alter table public.cos_posts add column if not exists avisos_at timestamptz;
create index if not exists cos_posts_avisos_pendientes on public.cos_posts (created_at) where status = 'PENDING_APPROVAL' and avisos_at is null;

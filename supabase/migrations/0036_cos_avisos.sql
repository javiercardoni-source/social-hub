-- 07-10-2026 · Avisos de la IA para quien aprueba (hoy: el texto nombra un ingrediente que no se
-- ve en la imagen y la IA insistió después de pedirle que lo corrija). Lista de textos cortos.
alter table public.cos_posts add column if not exists avisos jsonb not null default '[]'::jsonb;

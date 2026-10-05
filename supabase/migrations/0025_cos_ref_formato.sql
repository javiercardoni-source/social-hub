-- ============================================================================
-- Content OS — Referencias de estilo por formato (05-10-2026)
--
-- Javier: «la referencia de estilo aplica distinto a posts, reels e historias». Cada referencia
-- dice para qué formato es, y cada motor lee solo las suyas:
--   post      → el texto y la frase sobre la imagen de feed y carrusel (composición, tipografía, texto)
--   reel      → el guion del reel (ritmo de cortes, duración de tomas, movimientos, cuándo entra el texto)
--   historia  → las frases de historias (clima, feriados, versión historia de cada post)
-- Las que ya existían se clasifican por su archivo: video → reel, imagen → post (se cambia a mano).
-- ============================================================================

alter table public.cos_brand_assets add column para text check (para in ('post', 'reel', 'historia'));

update public.cos_brand_assets
   set para = case when mime like 'video/%' then 'reel' else 'post' end
 where kind = 'referencia';

alter table public.cos_brand_assets add constraint cos_brand_assets_para_ok
  check (kind <> 'referencia' or para is not null);

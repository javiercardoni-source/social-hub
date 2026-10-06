-- ============================================================================
-- Content OS — Plantillas propias por marca (06-10-2026)
--
-- Javier eligió en el mockup las plantillas de cada marca (shared/cos/plantillas.ts). Arman la pieza
-- ENTERA (la foto enmarcada, torcida, en grilla…), no una capa encima. Se usan:
--   · en un post de foto aparte que sale de cada foto (además del reel, otro día),
--   · en la historia de esa foto (si la marca tiene plantilla de historia),
--   · como tapa del reel en el perfil (cover_url).
--
-- cos_brands.plantillas   ids habilitados (la IA elige entre ellos; vacío = como antes)
-- cos_posts.diseno        {plantilla, campos, fotos?, numero?} — la pieza se dibuja con eso
-- cos_posts.tapa_key      tapa del reel dibujada con una plantilla (cos-media)
-- fuente_acento           tercera tipografía de la marca (manuscrita de Bijutsukan)
-- ============================================================================

alter table public.cos_brands add column plantillas text[] not null default '{}';
alter table public.cos_posts add column diseno jsonb;
alter table public.cos_posts add column tapa_key text;

alter table public.cos_brand_assets drop constraint if exists cos_brand_assets_kind_check;
alter table public.cos_brand_assets add constraint cos_brand_assets_kind_check
  check (kind in ('referencia', 'fuente_titulo', 'fuente_texto', 'fuente_acento', 'logo'));

update public.cos_brands set plantillas = '{bj_galeria,bj_editorial,bj_firma,bj_galeria_v}' where slug = 'bijutsukan';
update public.cos_brands set plantillas = '{sn_puro,sn_cartel}' where slug = 'sensaciones';
update public.cos_brands set plantillas = '{ff_arma5,ff_sticker,ff_grilla,ff_palabra,ff_encuesta}' where slug = 'fasutofudo';

-- La manuscrita de Bijutsukan ya estaba subida (06-10) esperando este casillero.
insert into public.cos_brand_assets (brand_id, kind, name, storage_key, mime, status)
select id, 'fuente_acento', 'Cormorant Garamond Medium Italic (Google Fonts)', 'brand/bijutsukan/acento/CormorantGaramond-MediumItalic.ttf', 'font/ttf', 'lista'
from public.cos_brands where slug = 'bijutsukan';

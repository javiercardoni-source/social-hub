-- ============================================================================
-- Content OS — Reels «palabra por corte» (06-10-2026)
--
-- Estilo karaoke (pedido de Javier para FasutoFudo, sale de una plantilla de CapCut): cada toma corta
-- muestra UNA palabra de una frase de la marca, que cae en el golpe de la música, y las tomas van en
-- marcos levemente inclinados sobre el color de la marca. Opción por marca; FasutoFudo arranca prendida.
-- ============================================================================

alter table public.cos_brands add column reel_karaoke boolean not null default false;
update public.cos_brands set reel_karaoke = true where slug = 'fasutofudo';

-- ============================================================================
-- Content OS — Paleta de marca (06-10-2026)
--
-- Los colores de las plantillas estaban fijos en el código (worker/src/overlay.ts → KITS).
-- Ahora viven acá; Javier los eligió en el mockup de paletas:
--   Bijutsukan  · Blanco y negro       (sin cambios)
--   Sensaciones · Terracota y crema
--   FasutoFudo  · Menta y rosa (pop japonés)
-- Formato: {"fondo","titulo","acento","acentoTexto"} en #rrggbb (ver shared/cos/paleta.ts).
-- ============================================================================

alter table public.cos_brands add column paleta jsonb;

update public.cos_brands set paleta = '{"fondo":"#0b0b0b","titulo":"#ffffff","acento":"#ffffff","acentoTexto":"#0b0b0b"}' where slug = 'bijutsukan';
update public.cos_brands set paleta = '{"fondo":"#1b100c","titulo":"#d0643f","acento":"#d0643f","acentoTexto":"#f6ead9"}', color = '#d0643f' where slug = 'sensaciones';
update public.cos_brands set paleta = '{"fondo":"#8fd3bf","titulo":"#14302a","acento":"#ff5c8a","acentoTexto":"#ffffff"}', color = '#ff5c8a' where slug = 'fasutofudo';

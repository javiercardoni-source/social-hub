-- ============================================================================
-- Content OS — QR en cualquier pieza de imprenta (06-10-2026)
--
-- Además del imán (que trae su QR a WhatsApp), Javier puede ponerle un QR a cualquier pieza:
-- {link, esquina} con esquina = abajo_derecha | abajo_izquierda | arriba_derecha | arriba_izquierda.
-- null = sin QR.
-- ============================================================================

alter table public.cos_print_pieces add column qr jsonb;

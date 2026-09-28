-- ============================================================================
-- Content OS — Datos comerciales vigentes por marca
--
-- El brandbook dice cómo habla la marca; esto dice qué es cierto hoy: precios, combos,
-- promos (con vencimiento), horarios, zonas y canales. La IA solo menciona lo que está acá.
-- Forma: shared/cos/datos-vigentes.ts (normalizarDatos). No entra en el hash de aprobación:
-- se usa al escribir el borrador, lo aprobado no cambia.
-- ============================================================================

alter table public.cos_brands
  add column datos_vigentes    jsonb not null default '{}'::jsonb,
  add column datos_vigentes_at timestamptz,
  add column datos_vigentes_by uuid references auth.users(id);

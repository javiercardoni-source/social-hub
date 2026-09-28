-- ============================================================================
-- Content OS — Branding Manager: entrevista de marca y brandbook
--
-- Método de la skill brand-discovery (una pregunta por vez, laddering, 5 porqués,
-- técnicas proyectivas, cierre por saturación), adaptado a marcas de comida:
-- módulos de propósito, posicionamiento, público, personalidad, voz, identidad visual
-- y reglas de contenido. Cada módulo guarda la conversación y su síntesis; al final
-- se arma el brandbook, que Javier aprueba y pasa a ser la fuente de la IA.
-- ============================================================================

create table public.cos_brand_interviews (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.cos_brands(id) on delete cascade,
  module      text not null check (module in ('proposito', 'posicionamiento', 'publico', 'personalidad', 'voz', 'visual', 'reglas')),
  messages    jsonb not null default '[]'::jsonb,   -- [{role: 'assistant'|'user', content, at}]
  summary_md  text,                                  -- síntesis del módulo al cerrarlo
  status      text not null default 'in_progress' check (status in ('in_progress', 'done')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (brand_id, module)
);
create trigger cos_brand_interviews_touch before update on public.cos_brand_interviews
  for each row execute function public.cos_touch_updated_at();

alter table public.cos_brand_interviews enable row level security;
create policy cos_brand_interviews_read on public.cos_brand_interviews
  for select to authenticated using (public.cos_is_member());

-- El brandbook vive en la marca. Mientras está en borrador, la IA sigue usando tone_md;
-- al aprobarlo, tone_md pasa a ser el brandbook (la versión compacta para los prompts).
alter table public.cos_brands
  add column brandbook_md          text,
  add column brandbook_status      text not null default 'none' check (brandbook_status in ('none', 'draft', 'approved')),
  add column brandbook_approved_at timestamptz,
  add column brandbook_approved_by uuid references auth.users(id);

-- ============================================================================
-- Content OS — marcas y cuentas iniciales                    PLAN-CONTENT-OS.md §9.3
--
-- Idempotente: se puede correr de nuevo sin duplicar nada.
-- Fuentes: knowledge-base/negocio/marcas/*.md y .credentials/meta-ads.json.
-- StohrBurgers NO va: está dada de baja (26-09-2026).
--
-- Las cuentas nacen en 'pending': pasan a 'connected' cuando el worker prueba el
-- token de verdad. Instagram y Facebook de una marca usan el MISMO page token
-- (Facebook Login for Business), por eso comparten token_ref.
-- `tone_md` queda vacío: lo llena el script sync-brands desde el knowledge-base.
-- ============================================================================

insert into public.cos_brands (slug, name, color, turnos_slugs, whatsapp_number, rules_json) values
  ('sensaciones', 'Sensaciones de Oriente', '#f97316', '{sensaciones}', '5491138833829',
   '{"forbidden_words": ["restaurante", "gourmet", "dark kitchen", "oferta", "liquidación"]}'),
  ('bijutsukan',  'Bijutsukan',             '#8b5cf6', '{bijutsukan}',  '5491167972415',
   '{"forbidden_words": ["restaurante", "gourmet", "dark kitchen", "oferta", "liquidación"]}'),
  ('fasutofudo',  'FasutoFudo',             '#ef4444', '{fasutofudo}',  '5491126222202',
   '{"forbidden_words": ["restaurante", "gourmet", "dark kitchen", "oferta", "liquidación"],
     "open_days": "martes a sábado", "open_hours": "16:30 a 22:30"}')
on conflict (slug) do nothing;

insert into public.cos_social_accounts (brand_id, platform, external_id, display_name, token_ref)
select b.id, a.platform, a.external_id, a.display_name, a.token_ref
from (values
  ('sensaciones', 'facebook',  '333425610087983',   'Sensaciones de Oriente', 'META_PAGE_TOKEN_SENSACIONES'),
  ('sensaciones', 'instagram', '17841404968403096', '@sensacionesdeoriente',  'META_PAGE_TOKEN_SENSACIONES'),
  ('bijutsukan',  'facebook',  '103552051939142',   'Bijutsukan',             'META_PAGE_TOKEN_BIJUTSUKAN'),
  ('bijutsukan',  'instagram', '17841446127051208', '@bijutsukansushi',       'META_PAGE_TOKEN_BIJUTSUKAN'),
  ('fasutofudo',  'facebook',  '862367476948970',   'FasutoFudo',             'META_PAGE_TOKEN_FASUTOFUDO'),
  ('fasutofudo',  'instagram', '17841477485052896', '@fasutofudo',            'META_PAGE_TOKEN_FASUTOFUDO')
) as a (brand_slug, platform, external_id, display_name, token_ref)
join public.cos_brands b on b.slug = a.brand_slug
on conflict (platform, external_id) do nothing;

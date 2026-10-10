-- ============================================================================
-- Content OS — Sets de anuncios a pedido (10-10-2026)
--
-- Desde Anuncios → «Crear set», Javier escribe los textos que van SOBRE la pieza (ej. «Puro salmón
-- 40 piezas · Comé en casa») y los detalles para la IA (qué producto mostrar, tono, público). La IA
-- escribe versiones de ese texto, elige material REAL (Instagram publicado, el Archivo de los
-- empleados o lo que Javier eligió a mano) y el worker arma cada versión en 9:16 y 4:5, en video
-- y/o imagen. El resultado es un set PARA DESCARGAR: no pasa por Meta.
--
-- cos_ad_sets            el pedido (textos, detalles, de dónde sale el material, cuántas versiones)
-- cos_ad_set_versiones   una fila por versión: su texto, el material que usa y sus piezas
--
-- Una fila por versión (y no un jsonb en el pedido) para que cada versión se arme en su propio
-- trabajo (ads:set-version) sin pisarse al guardar.
-- ============================================================================

create table public.cos_ad_sets (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.cos_brands(id) on delete cascade,
  textos      text not null check (char_length(btrim(textos)) between 2 and 300),
  detalles    text check (char_length(detalles) <= 1500),
  versiones   smallint not null default 3 check (versiones between 1 and 6),
  formato     text not null default 'ambos' check (formato in ('video', 'imagen', 'ambos')),
  -- De dónde sale el material: lo publicado en Instagram, el Archivo, y/o lo elegido a mano.
  fuentes     text[] not null default '{instagram,archivo}'
              check (cardinality(fuentes) between 1 and 3 and fuentes <@ array['instagram', 'archivo', 'manual']),
  -- Lo elegido a mano: [{ "origen": "instagram" | "archivo", "id": "<cos_media.id | cos_assets.id>" }]
  elegidos    jsonb not null default '[]' check (jsonb_typeof(elegidos) = 'array'),
  estado      text not null default 'preparando' check (estado in ('preparando', 'armando', 'lista', 'error')),
  -- Lo que eligió la IA y por qué (para mostrarlo).
  material    jsonb not null default '[]' check (jsonb_typeof(material) = 'array'),
  motivo      text,
  error       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index cos_ad_sets_brand on public.cos_ad_sets (brand_id, created_at desc);
create trigger cos_ad_sets_touch before update on public.cos_ad_sets
  for each row execute function public.cos_touch_updated_at();

create table public.cos_ad_set_versiones (
  id          uuid primary key default gen_random_uuid(),
  set_id      uuid not null references public.cos_ad_sets(id) on delete cascade,
  numero      smallint not null check (numero between 1 and 6),
  texto       text not null,          -- lo que va escrito sobre la pieza
  copy        text,                   -- texto sugerido para acompañar la publicación o el anuncio
  -- Índices dentro de cos_ad_sets.material que usa esta versión (en orden).
  material    int[] not null default '{}',
  estado      text not null default 'armando' check (estado in ('armando', 'lista', 'error')),
  -- [{ "formato": "9x16" | "4x5", "tipo": "video" | "imagen", "key": "<ruta en cos-media>" }]
  piezas      jsonb not null default '[]' check (jsonb_typeof(piezas) = 'array'),
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (set_id, numero)
);
create trigger cos_ad_set_versiones_touch before update on public.cos_ad_set_versiones
  for each row execute function public.cos_touch_updated_at();

-- Lectura para miembros; las escrituras van por el service role (acciones del servidor y worker).
alter table public.cos_ad_sets enable row level security;
alter table public.cos_ad_set_versiones enable row level security;
create policy cos_ad_sets_read on public.cos_ad_sets for select to authenticated using (public.cos_is_member());
create policy cos_ad_set_versiones_read on public.cos_ad_set_versiones for select to authenticated using (public.cos_is_member());
revoke all on public.cos_ad_sets, public.cos_ad_set_versiones from anon, authenticated;
grant select on public.cos_ad_sets, public.cos_ad_set_versiones to authenticated;
grant all on public.cos_ad_sets, public.cos_ad_set_versiones to service_role;

-- ============================================================================
-- Content OS — Diseño gráfico para imprenta (06-10-2026)
--
-- Javier carga las medidas de lo que manda a imprimir (imanes, envoltorios, bolsas, cintas) y el
-- motor dibuja la pieza con la plantilla y la paleta de la marca: JPG a 300 dpi con 3 mm de
-- sangrado por lado (el borde se extiende en espejo, así la guillotina no deja filetes blancos).
--
-- cos_print_formats  medidas (las define Javier; son de todas las marcas)
-- cos_print_pieces   cada pieza armada: marca, formato, plantilla, textos, foto y el JPG final
-- ============================================================================

create table public.cos_print_formats (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (char_length(btrim(nombre)) between 1 and 80),
  ancho_mm    numeric(7,1) not null check (ancho_mm between 10 and 3000),
  alto_mm     numeric(7,1) not null check (alto_mm between 10 and 3000),
  sangrado_mm numeric(4,1) not null default 3 check (sangrado_mm between 0 and 20),
  dpi         int not null default 300 check (dpi between 72 and 600),
  created_at  timestamptz not null default now()
);

create table public.cos_print_pieces (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.cos_brands(id) on delete cascade,
  format_id   uuid not null references public.cos_print_formats(id) on delete restrict,
  plantilla   text not null,
  campos      jsonb not null default '{}',
  version_id  uuid references public.cos_asset_versions(id) on delete set null,
  estado      text not null default 'armando' check (estado in ('armando', 'lista', 'error')),
  archivo_key text,
  aviso       text,               -- ej. la foto queda chica para la medida
  error       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index cos_print_pieces_brand on public.cos_print_pieces (brand_id, created_at desc);

alter table public.cos_print_formats enable row level security;
alter table public.cos_print_pieces enable row level security;
create policy cos_print_formats_read on public.cos_print_formats for select to authenticated using (public.cos_is_member());
create policy cos_print_pieces_read on public.cos_print_pieces for select to authenticated using (public.cos_is_member());

-- El primero que pidió Javier.
insert into public.cos_print_formats (nombre, ancho_mm, alto_mm) values ('Imán 7 × 9 cm', 70, 90);

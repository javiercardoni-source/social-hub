-- ============================================================================
-- Content OS — Avisos push de la app de aprobación (F12, 07-10-2026)
--
-- El celular de Javier (la app /app instalada) se suscribe a Web Push; el worker le avisa cuando
-- hay piezas nuevas listas para aprobar: uno por tanda, nunca de noche.
--
-- cos_push_subs  una suscripción por dispositivo (endpoint del navegador + claves)
-- cos_push_log   cada aviso mandado (para no repetir y saber desde cuándo contar "nuevas")
-- ============================================================================

create table public.cos_push_subs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique check (endpoint like 'https://%'),
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
alter table public.cos_push_subs enable row level security;
-- Solo el servidor (service role) lee y escribe: los endpoints son secretos de cada dispositivo.

create table public.cos_push_log (
  id          uuid primary key default gen_random_uuid(),
  sent_at     timestamptz not null default now(),
  nuevas      int not null,
  pendientes  int not null,
  enviados    int not null,
  detalle     jsonb
);
alter table public.cos_push_log enable row level security;

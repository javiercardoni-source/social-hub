-- 08-10-2026 · Javier: las historias automáticas (clima y feriado) "por ahora siempre aprobadas".
-- El worker las aprueba en cuanto su pieza final está lista, en nombre del aprobador configurado
-- (orden permanente de Javier); se apaga con historias_auto = false.
alter table public.cos_settings add column if not exists historias_auto boolean not null default true;
alter table public.cos_settings add column if not exists aprobador_auto uuid references auth.users(id);
update public.cos_settings
   set aprobador_auto = (select user_id from public.cos_members where role in ('admin', 'approver') order by created_at limit 1)
 where aprobador_auto is null;

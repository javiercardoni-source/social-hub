-- ============================================================================
-- Content OS — F9 Video primero: motor de reels (.gauntlet/features/f9-reels/spec.md)
--
-- · cos_posts.montaje: el guion del reel (tomas, textos, música, cierre con precio/pie ya
--   resueltos desde Datos vigentes). El worker arma el video desde acá (post:render).
--   NO entra en el hash de aprobación (lo que se ve y cambia la aprobación ya está en el hash:
--   overlay_text = gancho, music_key). Para que igual nunca salga algo distinto de lo que se vio,
--   la base no deja cambiar el guion de un post que ya salió de borrador / esperando aprobación.
-- · cos_settings.foto_fija: post de foto fija (el de siempre) en vez de reel. Apagado: se basa
--   todo en video (decisión de Javier, 30-09).
-- ============================================================================

alter table public.cos_posts add column montaje jsonb;

create or replace function public.cos_posts_montaje_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.montaje is distinct from old.montaje and old.status not in ('DRAFT', 'PENDING_APPROVAL') then
    raise exception 'cos: el guion del reel no se cambia con el post en % (devolvelo a aprobación)', old.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger cos_posts_montaje_guard before update of montaje on public.cos_posts
  for each row execute function public.cos_posts_montaje_guard();

revoke execute on function public.cos_posts_montaje_guard() from public, anon, authenticated;

alter table public.cos_settings add column foto_fija boolean not null default false;

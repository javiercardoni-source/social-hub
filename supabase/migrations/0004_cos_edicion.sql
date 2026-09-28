-- ============================================================================
-- Content OS — edición básica: texto sobre la imagen, plantilla de marca y música
--
-- · overlay_text: frase corta que va ENCIMA de la imagen (distinta del caption).
-- · template: cómo se dibuja (none | banda | etiqueta | firma), con los colores,
--   tipografía y logo de cada marca (worker/src/overlay.ts).
-- · music_key: tema de la biblioteca de la marca (para reels armados con fotos).
-- · render_key: la imagen/video final que arma el worker. Es DERIVADO: no entra en
--   el hash; lo que se aprueba es el contenido (texto, plantilla, música, archivos).
--
-- Los tres campos de contenido entran en el hash de aprobación: si se cambian
-- después de aprobar, el post vuelve a PENDING_APPROVAL (igual que el caption).
-- ============================================================================

alter table public.cos_posts
  add column overlay_text text not null default '' check (char_length(overlay_text) <= 80),
  add column template     text not null default 'none' check (template in ('none', 'banda', 'etiqueta', 'firma')),
  add column music_key    text,
  add column render_key   text;

create or replace function public.cos_compute_post_hash_v2(
  p_post_id uuid, p_caption text, p_hashtags text, p_account_id uuid,
  p_post_type text, p_scheduled_at timestamptz,
  p_overlay_text text, p_template text, p_music_key text
) returns text language sql stable set search_path = public as $$
  select encode(sha256(convert_to(concat_ws(
    E'\x1f',
    public.cos_compute_post_hash(p_post_id, p_caption, p_hashtags, p_account_id, p_post_type, p_scheduled_at),
    coalesce(p_overlay_text, ''),
    coalesce(p_template, ''),
    coalesce(p_music_key, '')
  ), 'UTF8')), 'hex');
$$;

create or replace function public.cos_post_content_hash(p_post_id uuid)
returns text language sql stable set search_path = public as $$
  select public.cos_compute_post_hash_v2(p.id, p.caption, p.hashtags, p.account_id, p.post_type,
                                         p.scheduled_at, p.overlay_text, p.template, p.music_key)
  from public.cos_posts p where p.id = p_post_id;
$$;

-- Mismo guardián que en 0001, con los campos nuevos en "cambió el contenido" y en el hash.
create or replace function public.cos_posts_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_content_changed boolean;
  v_hash text;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('DRAFT', 'PENDING_APPROVAL') then
      raise exception 'cos: un post nace como DRAFT o PENDING_APPROVAL, no %', new.status
        using errcode = 'check_violation';
    end if;
    new.approved_by := null; new.approved_at := null; new.approved_hash := null;
    return new;
  end if;

  v_content_changed :=
    (new.caption, new.hashtags, new.account_id, new.post_type, new.scheduled_at, new.brand_id, new.platform,
     new.overlay_text, new.template, new.music_key)
    is distinct from
    (old.caption, old.hashtags, old.account_id, old.post_type, old.scheduled_at, old.brand_id, old.platform,
     old.overlay_text, old.template, old.music_key);

  if v_content_changed and old.status in ('PUBLISHING', 'PUBLISHED') then
    raise exception 'cos: un post en % no se puede editar', old.status using errcode = 'check_violation';
  end if;

  -- Editar algo que ya estaba aprobado (o en camino) lo devuelve a aprobación.
  if v_content_changed and new.status = old.status and old.status in
     ('APPROVED', 'SCHEDULED', 'PAUSED', 'RETRY_SCHEDULED', 'FAILED', 'MISSED', 'EXPIRED') then
    new.status := 'PENDING_APPROVAL';
  end if;

  if new.status is distinct from old.status and not exists (
    select 1 from public.cos_post_transitions() t
    where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'cos: transición no permitida % → %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Toda vuelta atrás borra la aprobación.
  if new.status in ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'EXPIRED') then
    new.approved_by := null; new.approved_at := null; new.approved_hash := null;
  end if;

  v_hash := public.cos_compute_post_hash_v2(new.id, new.caption, new.hashtags, new.account_id,
                                            new.post_type, new.scheduled_at,
                                            new.overlay_text, new.template, new.music_key);

  if new.status = 'APPROVED' and old.status <> 'APPROVED' then
    if new.approved_by is null then
      raise exception 'cos: falta quién aprueba (approved_by)' using errcode = 'check_violation';
    end if;
    new.approved_at := now();
    new.approved_hash := v_hash;          -- lo sella la base, no el cliente
  elsif new.approved_hash is distinct from old.approved_hash
        and new.status not in ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'EXPIRED') then
    raise exception 'cos: approved_hash solo lo escribe la base al aprobar' using errcode = 'check_violation';
  end if;

  if new.status in ('SCHEDULED', 'PUBLISHING') then
    if new.approved_hash is null or new.approved_hash <> v_hash then
      raise exception 'cos: el contenido no coincide con lo aprobado' using errcode = 'check_violation';
    end if;
    if new.status = 'SCHEDULED' and new.scheduled_at is null then
      raise exception 'cos: no se puede programar sin fecha' using errcode = 'check_violation';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

revoke execute on function
  public.cos_compute_post_hash_v2(uuid, text, text, uuid, text, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.cos_compute_post_hash_v2(uuid, text, text, uuid, text, timestamptz, text, text, text)
  to service_role;

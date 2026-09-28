-- ============================================================================
-- Content OS — borrar lo publicado
--
-- Un post publicado no cambia de estado al borrarlo: sigue siendo PUBLISHED (salió, y eso
-- queda en la historia) y se marca aparte cuándo se pidió y cuándo se borró de la red.
-- El worker hace el borrado (es el único que habla con Meta): trabajo post:delete.
-- Estos campos no son contenido: no tocan el hash de aprobación.
-- ============================================================================

alter table public.cos_posts
  add column delete_requested_at timestamptz,
  add column delete_requested_by uuid references auth.users(id),
  add column deleted_at          timestamptz,
  add column delete_error        text;

-- Solo se puede pedir borrar algo que salió.
alter table public.cos_posts
  add constraint cos_posts_delete_only_published
  check (delete_requested_at is null or status = 'PUBLISHED');

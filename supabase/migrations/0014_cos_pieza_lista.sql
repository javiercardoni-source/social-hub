-- ============================================================================
-- Content OS — Aprobaciones muestra una subida recién cuando TODAS sus piezas finales
-- (plantilla + música + revisión de la IA) estuvieron listas alguna vez.
--
-- first_render_at se pone la primera vez y nunca se borra: si Javier edita y la pieza se
-- vuelve a armar, el borrador sigue a la vista (no desaparece mientras lo edita).
-- No entra en el hash de aprobación.
-- ============================================================================

alter table public.cos_posts add column first_render_at timestamptz;

-- Lo que ya tenía pieza revisada cuenta como listo.
update public.cos_posts set first_render_at = coalesce(updated_at, now())
where first_render_at is null and render_qa is not null;

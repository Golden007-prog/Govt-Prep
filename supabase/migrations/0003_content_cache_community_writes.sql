-- Shared content cache, community writes (v3 Claude-only architecture).
-- The browser generates study bundles / CA digests / mock papers with the user's own
-- Anthropic key and contributes them to the shared cache so other users of the same
-- exam never pay to regenerate them. Reads stay world-readable; writes require a
-- signed-in (GitHub OAuth) user. The unique index on (exam_family, topic_id, type,
-- language, version) makes duplicate contributions harmless no-ops client-side.

create policy "authed insert content_cache"
  on public.content_cache
  for insert
  to authenticated
  with check (true);

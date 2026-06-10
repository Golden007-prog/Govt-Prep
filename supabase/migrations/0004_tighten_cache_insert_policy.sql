-- Tighten the community-cache INSERT policy (advisor lint 0024: with check (true)).
-- Contributions must be one of the known artifact types, version 1, sane key lengths,
-- a supported language, and under 1 MB — enough to stop garbage/abuse while keeping
-- the generate-once-share-everywhere economics.

drop policy "authed insert content_cache" on public.content_cache;

create policy "authed insert content_cache"
  on public.content_cache
  for insert
  to authenticated
  with check (
    type in ('notes', 'quiz', 'cards', 'homework', 'homework-md', 'mnemonics', 'ca-digest')
    and version = 1
    and char_length(exam_family) <= 64
    and char_length(topic_id) <= 64
    and language in ('en', 'hi')
    and pg_column_size(content) < 1048576
  );

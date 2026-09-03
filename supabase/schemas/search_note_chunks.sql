-- search_note_chunks: hybrid retrieval for cross-note chat, per ROADMAP.md §4.
--
-- NOT security definer. It runs as the caller, so RLS on notes and
-- note_chunks does the owner-scoping. There is deliberately NO
-- `user_id = auth.uid()` filter in this body and none around it in app code:
-- a redundant filter would mask an RLS failure instead of exposing it, which
-- is the standing rule in CLAUDE.md § Supabase → RLS rules.
--
-- The candidate pool is ONE clause. `created_at > now() - interval '90 days'
-- order by created_at desc limit 25` naturally yields whichever bound is
-- smaller: 25 for a busy month, fewer (or none) for a quiet year. No second
-- branch, nothing to keep in sync.
--
-- The result cap is unconditional: 25 chunks post-RRF, whatever the pool.
--
-- set search_path = '' is what the database linter wants, and it has two
-- consequences that are easy to get wrong and hard to notice:
--
--   * <=> lives in extensions, not pg_catalog, so with an empty search path
--     it is unresolvable. It is written operator(extensions.<=>).
--
--   * 'english'::regconfig ALSO resolves through the search path. It is
--     written 'pg_catalog.english'::regconfig, which is the same OID
--     note_chunks_content_fts_idx was built with -- an index expression is
--     matched by OID, not by spelling, so this is what keeps the gin index
--     in play. Proved with EXPLAIN rather than assumed; a mismatch here does
--     not error, it silently sequential-scans every chunk ever written.
--
-- Every statement is idempotent so the whole file can be re-applied.

create or replace function public.search_note_chunks(
  query_embedding extensions.vector(1024),
  query_text text
)
returns table (
  chunk_id uuid,
  note_id uuid,
  note_title text,
  chunk_type text,
  content text,
  ts_start text,
  seq int,
  score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with candidates as (
    select n.id, n.title
    from public.notes n
    where n.created_at > now() - interval '90 days'
    order by n.created_at desc
    limit 25
  ),
  vector_arm as (
    select
      c.id,
      row_number() over (
        order by c.embedding operator(extensions.<=>) query_embedding
      ) as rank
    from public.note_chunks c
    join candidates k on k.id = c.note_id
    where c.embedding is not null
    order by c.embedding operator(extensions.<=>) query_embedding
    limit 50
  ),
  text_arm as (
    select
      c.id,
      row_number() over (
        order by ts_rank(
          to_tsvector('pg_catalog.english'::regconfig, c.content),
          plainto_tsquery('pg_catalog.english'::regconfig, query_text)
        ) desc
      ) as rank
    from public.note_chunks c
    join candidates k on k.id = c.note_id
    where to_tsvector('pg_catalog.english'::regconfig, c.content)
          @@ plainto_tsquery('pg_catalog.english'::regconfig, query_text)
    order by ts_rank(
      to_tsvector('pg_catalog.english'::regconfig, c.content),
      plainto_tsquery('pg_catalog.english'::regconfig, query_text)
    ) desc
    limit 50
  ),
  fused as (
    select
      coalesce(v.id, t.id) as id,
      -- Reciprocal rank fusion, k = 60. A chunk found by both arms scores the
      -- sum, which is what makes hybrid beat either arm alone: pure embedding
      -- similarity misses proper nouns and dollar figures, and pure full text
      -- misses paraphrase.
      coalesce(1.0 / (60 + v.rank), 0.0)
        + coalesce(1.0 / (60 + t.rank), 0.0) as score
    from vector_arm v
    full outer join text_arm t on t.id = v.id
  )
  select
    c.id as chunk_id,
    c.note_id,
    k.title as note_title,
    c.chunk_type,
    c.content,
    c.metadata ->> 'ts_start' as ts_start,
    (c.metadata ->> 'seq')::int as seq,
    f.score
  from fused f
  join public.note_chunks c on c.id = f.id
  join candidates k on k.id = c.note_id
  order by f.score desc, c.id
  limit 25;
$$;

-- Revoke first, then grant, so this file is the sole authority. Postgres
-- grants EXECUTE on new functions to PUBLIC by default, which would hand anon
-- a retrieval endpoint -- RLS would return them nothing, but an
-- unauthenticated caller should not reach the function at all.
revoke all on function public.search_note_chunks(extensions.vector(1024), text)
  from public, anon, authenticated, service_role;

grant execute on function public.search_note_chunks(extensions.vector(1024), text)
  to authenticated;

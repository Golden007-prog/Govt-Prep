-- GovPrep initial schema (spec §6). Hosted multi-user backend on Supabase Postgres.
-- Principle (§2): expensive AI work is cached per (exam-family, topic, date) and SHARED across
-- users; per-user rows are isolated by Row-Level Security.
--
-- Apply via Supabase MCP `apply_migration`, or `supabase db push`.

-- ---------------------------------------------------------------------------
-- Shared / content tables (read by everyone, written only by service-role /
-- Edge Functions). These hold the cached, generate-once content.
-- ---------------------------------------------------------------------------

create table if not exists public.exams (
  id                       text primary key,
  name                     text not null,
  short_name               text not null,
  body                     text not null,
  family                   text not null,
  category                 text not null,
  languages                text[] not null default '{en}',
  pattern                  jsonb not null,
  taxonomy                 jsonb,                 -- full ExamTaxonomy (denormalized mirror of bundled JSON)
  total_questions          int not null,
  total_duration_minutes   int not null,
  negative_marking         numeric not null default 0,
  has_sectional_timing     boolean not null default false,
  verification             text not null default 'unverified',
  sources                  text[] not null default '{}',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table if not exists public.subjects (
  exam_id     text not null references public.exams(id) on delete cascade,
  id          text not null,
  paper_id    text not null,
  name        text not null,
  weight_pct  numeric,
  ordering    int not null default 0,
  primary key (exam_id, id)
);

create table if not exists public.topics (
  exam_id        text not null references public.exams(id) on delete cascade,
  id             text not null,
  subject_id     text not null,
  name           text not null,
  ordering       int not null default 0,
  syllabus_text  text not null default '',
  importance     text not null default 'medium',
  primary key (exam_id, id)
);

create table if not exists public.content_cache (
  id           uuid primary key default gen_random_uuid(),
  exam_family  text not null,
  topic_id     text not null,
  type         text not null,                 -- notes | quiz | cards | homework | ca-digest
  language     text not null default 'en',
  version      int not null default 1,
  content      jsonb not null,
  created_at   timestamptz not null default now(),
  unique (exam_family, topic_id, type, language, version)
);

create table if not exists public.questions (
  id           uuid primary key default gen_random_uuid(),
  exam_tags    text[] not null default '{}',
  subject      text,
  topic        text,
  difficulty   text,
  stem         text not null,
  options      jsonb,
  answer       text not null,
  explanation  text,
  source       text not null default 'AI',     -- PYQ | AI
  lang         text not null default 'en',
  created_at   timestamptz not null default now()
);

create table if not exists public.current_affairs (
  id              uuid primary key default gen_random_uuid(),
  date            date not null,
  summary         text not null,
  source_url      text not null,
  subject         text,
  region          text,                         -- national | state | international
  exam_relevance  text[] not null default '{}',
  lang            text not null default 'en',
  created_at      timestamptz not null default now()
);

create table if not exists public.ca_sets (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  exam_family  text not null,
  question_ids uuid[] not null default '{}',
  created_at   timestamptz not null default now(),
  unique (date, exam_family)
);

create table if not exists public.mock_templates (
  id         text primary key,
  exam_id    text not null references public.exams(id) on delete cascade,
  sections   jsonb not null,                    -- per-section qcount + timing, marks, negative, cutoffs
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Per-user tables (RLS: a user sees only their own rows).
-- ---------------------------------------------------------------------------

create table if not exists public.users (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text,
  display_name   text,
  target_exam_id text,
  exam_date      date,
  language_pref  text not null default 'en',
  tier           text not null default 'free',
  plan_state     jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.study_plans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  exam_id      text not null,
  plan         jsonb not null,
  version      int not null default 1,
  generated_at timestamptz not null default now(),
  unique (user_id, exam_id)
);

create table if not exists public.user_progress (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  exam_id    text not null,
  topic_id   text not null,
  mastery    numeric not null default 0,
  streak     int not null default 0,
  xp         int not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, exam_id, topic_id)
);

create table if not exists public.fsrs_cards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  card_id     text not null,
  topic_id    text,
  front       text not null,
  back        text not null,
  due         timestamptz not null default now(),
  stability   numeric not null default 0,
  difficulty  numeric not null default 0,
  reps        int not null default 0,
  lapses      int not null default 0,
  state       int not null default 0,
  last_review timestamptz,
  lang        text not null default 'en',
  unique (user_id, card_id)
);

create table if not exists public.mock_attempts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  template_id      text,
  exam_id          text not null,
  answers          jsonb not null default '{}',
  per_question_time jsonb not null default '{}',
  marked           jsonb not null default '{}',
  score            numeric,
  sectional_scores jsonb,
  autosaved_state  jsonb,                        -- answers + remaining time for crash-safe resume (§7d)
  submitted_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_content_cache_lookup on public.content_cache (exam_family, topic_id, type, language);
create index if not exists idx_current_affairs_date on public.current_affairs (date);
create index if not exists idx_study_plans_user on public.study_plans (user_id);
create index if not exists idx_mock_attempts_user on public.mock_attempts (user_id, exam_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create trigger trg_users_updated   before update on public.users        for each row execute function public.set_updated_at();
create trigger trg_attempts_updated before update on public.mock_attempts for each row execute function public.set_updated_at();
create trigger trg_exams_updated    before update on public.exams        for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

-- Shared content: readable by anon + authenticated; writes only via service-role (bypasses RLS).
alter table public.exams           enable row level security;
alter table public.subjects        enable row level security;
alter table public.topics          enable row level security;
alter table public.content_cache   enable row level security;
alter table public.questions       enable row level security;
alter table public.current_affairs enable row level security;
alter table public.ca_sets         enable row level security;
alter table public.mock_templates  enable row level security;

create policy "shared read exams"           on public.exams           for select using (true);
create policy "shared read subjects"        on public.subjects        for select using (true);
create policy "shared read topics"          on public.topics          for select using (true);
create policy "shared read content_cache"   on public.content_cache   for select using (true);
create policy "shared read questions"       on public.questions       for select using (true);
create policy "shared read current_affairs" on public.current_affairs for select using (true);
create policy "shared read ca_sets"         on public.ca_sets         for select using (true);
create policy "shared read mock_templates"  on public.mock_templates  for select using (true);

-- Per-user: full CRUD on own rows only.
alter table public.users         enable row level security;
alter table public.study_plans   enable row level security;
alter table public.user_progress enable row level security;
alter table public.fsrs_cards    enable row level security;
alter table public.mock_attempts enable row level security;

create policy "own row"   on public.users         for all using (auth.uid() = id)      with check (auth.uid() = id);
create policy "own plans" on public.study_plans   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own prog"  on public.user_progress for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own cards" on public.fsrs_cards    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own mocks" on public.mock_attempts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Auto-provision a public.users row when a new auth user signs up (GitHub OAuth).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'user_name', new.raw_user_meta_data->>'full_name'))
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

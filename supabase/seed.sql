-- GovPrep seed: exam header rows so the hosted `exams` table is queryable.
-- The full taxonomy (subjects/topics) is bundled in the frontend (src/data/exams) for M0/M1;
-- a generator that mirrors it into public.subjects / public.topics lands in M2.
-- Idempotent: safe to re-run.

insert into public.exams
  (id, name, short_name, body, family, category, languages, total_questions, total_duration_minutes, negative_marking, has_sectional_timing, verification, sources, pattern)
values
  (
    'cil-mt-systems',
    'Coal India Ltd — Management Trainee (Systems)',
    'CIL MT — Systems',
    'Coal India Limited',
    'cil-mt',
    'Technical PSU',
    '{en,hi}',
    200, 180, 0, false, 'partial',
    '{https://www.coalindia.in/career-cil/jobs-coal-india/recruitment-of-management-trainee-through-computer-based-test-cbt-26/}',
    '{"papers":[{"id":"paper-1-general-aptitude","qcount":100,"marksPerQuestion":1,"negativeMarking":0},{"id":"paper-2-professional-systems","qcount":100,"marksPerQuestion":1,"negativeMarking":0}],"totalQuestions":200,"totalDurationMinutes":180,"negativeMarking":0,"hasSectionalTiming":false}'::jsonb
  ),
  (
    'ssc-cgl-tier1',
    'SSC Combined Graduate Level — Tier I',
    'SSC CGL — Tier I',
    'Staff Selection Commission',
    'ssc-cgl',
    'SSC',
    '{en,hi}',
    100, 60, 0.5, false, 'unverified',
    '{https://ssc.gov.in/}',
    '{"papers":[{"id":"tier-1","qcount":100,"marksPerQuestion":2,"negativeMarking":0.5}],"totalQuestions":100,"totalDurationMinutes":60,"negativeMarking":0.5,"hasSectionalTiming":false}'::jsonb
  )
on conflict (id) do nothing;

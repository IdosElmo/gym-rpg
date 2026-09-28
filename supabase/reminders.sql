-- ============================================================================
-- 🔔 Meal reminders — run ONCE in Supabase → SQL Editor, after schema.sql.
--
-- Part 1 is safe to re-run. Part 2 needs two values filled in first
-- (the project URL is already right; the secret is the CRON_SECRET you set
-- on the Edge Function) and schedules the hourly call.
-- ============================================================================

-- ---------------------------------------------------------------- part 1
-- One row per device that turned reminders on. The endpoint (the browser's
-- push address) is the key: turning reminders on again on the same device
-- updates its row instead of adding a second one.
create table if not exists public.push_subscriptions (
  endpoint   text        primary key,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  -- The subscription's encryption keys (public — they let a server encrypt
  -- TO this device, nothing more).
  p256dh     text        not null,
  auth       text        not null,
  -- The device's IANA time zone ("Asia/Jerusalem"): windows are local hours.
  tz         text        not null default 'Asia/Jerusalem',
  -- The windows and suggestions, uploaded by the app from its own catalog.
  schedule   jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Every policy is scoped to the signed-in user, exactly like `events`. The
-- Edge Function reads all rows with the service role, which bypasses RLS.
drop policy if exists "push: read own" on public.push_subscriptions;
create policy "push: read own" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "push: insert own" on public.push_subscriptions;
create policy "push: insert own" on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "push: update own" on public.push_subscriptions;
create policy "push: update own" on public.push_subscriptions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "push: delete own" on public.push_subscriptions;
create policy "push: delete own" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- The function's "already logged?" lookup filters events by type, date and
-- slot inside the payload; this keeps it an index scan per user.
create index if not exists events_user_type_idx on public.events (user_id, type);

-- ---------------------------------------------------------------- part 2
-- The hourly call. Replace PASTE_CRON_SECRET_HERE with the same value as the
-- function's CRON_SECRET, then run. (Re-running replaces the job.)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('meal-reminders')
where exists (select 1 from cron.job where jobname = 'meal-reminders');

select cron.schedule(
  'meal-reminders',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://omiqettlrjbcafnmomrm.supabase.co/functions/v1/meal-reminders',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', 'PASTE_CRON_SECRET_HERE'
    ),
    body    := '{}'::jsonb
  );
  $$
);

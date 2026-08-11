-- =====================================================================
--  gym-rpg — cloud sync schema (Supabase / Postgres)
--
--  Apply once per project: Supabase dashboard → SQL editor → paste → run
--  (or `supabase db push` with the CLI). It is idempotent: running it twice
--  is a no-op.
--
--  THE WHOLE BACKEND IS THIS FILE. There is no server code: the app talks to
--  PostgREST directly with the public anon key, and ROW LEVEL SECURITY is the
--  only security boundary. Everything below therefore has to hold even against
--  a hostile client holding that key.
--
--  ---------------------------------------------------------------------
--  DATA MODEL — an append-only event log, one row per client event
--  ---------------------------------------------------------------------
--  The client is event-sourced: game state is a pure fold of its event log
--  (`rebuildFromEvents`). Sync is therefore defined as *set union* of event
--  logs plus a deterministic replay — no merge conflicts exist, and the server
--  never has to understand a payload. It stores rows and hands them back.
--
--  Two invariants make that safe:
--
--   1. DEDUPE BY ID. `primary key (user_id, id)` — `id` is the uuid the client
--      minted for the event. Re-pushing an event (retry, reinstall, restored
--      backup) can never create a second copy, so a push is idempotent and the
--      client may retry freely.
--
--   2. A PULL CURSOR THAT CANNOT SKIP A ROW. Each row gets a per-user
--      monotonically increasing `seq` (below), and the client pulls
--      `seq > cursor order by seq`. For that to be lossless the following must
--      hold:
--
--          COMMIT-VISIBILITY ORDER == SEQ ORDER
--
--      i.e. it must be impossible for a row with a HIGHER seq to become visible
--      to a reader BEFORE a row with a lower seq. Otherwise a client could pull
--      seq 7 while seq 6 is still uncommitted, park its cursor at 7, and never
--      see 6 again — silent, permanent data loss.
--
--      A plain `max(seq)+1` or a sequence/identity column does NOT give that:
--      two concurrent transactions grab 6 and 7 and may commit in either order.
--      The counter row below is what serialises them: `assign_event_seq` takes
--      a ROW LOCK on the user's counter (`for update`) before handing out a
--      number and holds it until COMMIT, so a transaction that owns seq N is
--      committed before the transaction that gets N+1 is even allowed to read
--      the counter. Per user, pushes are strictly serialised; different users
--      never contend (the lock is per-row).
--
--      Cost: pushes for ONE user are serialised. That is exactly the intended
--      shape here — one human, a handful of devices, batches of 500 rows.
--
--  Numbers are dense but not guaranteed gap-free: an `on conflict do nothing`
--  insert (our upsert) still fires the BEFORE INSERT trigger, so a duplicate
--  row that is skipped burns a number. Gaps are harmless — the cursor only
--  needs monotonicity and the visibility rule above, never contiguity.
-- =====================================================================

-- ------------------------------------------------------------------ counters
-- One row per user: the highest seq handed out so far. This table is the
-- serialisation point described above; clients never touch it directly (RLS is
-- enabled with NO policies, so it is invisible to the anon/authenticated roles;
-- only the security-definer trigger, which runs as the table owner, can).
create table if not exists public.sync_counters (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  last_seq bigint not null default 0
);

-- -------------------------------------------------------------------- events
create table if not exists public.events (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  -- Client-minted event uuid. Also the dedupe key — see invariant (1).
  id          uuid        not null,
  -- Per-user monotonic push order. Assigned by the trigger; never by a client.
  seq         bigint,
  -- Client event timestamp (epoch ms). This is the ORDERING the app folds by
  -- (`(ts, id)`), and it is deliberately NOT `seq`: replay order must be a
  -- property of the event set itself, identical on every device, including
  -- devices that were offline when the events were created.
  ts          bigint      not null,
  -- Which install wrote the event. Bookkeeping only (never ordering).
  device      text,
  type        text        not null,
  payload     jsonb       not null default '{}'::jsonb,
  inserted_at timestamptz not null default now(),
  primary key (user_id, id),
  -- Belt and braces: even if the trigger were ever bypassed, two rows of one
  -- user could not share a cursor position.
  unique (user_id, seq)
);

-- The only query the client ever runs against this table:
--   where user_id = $1 and seq > $2 order by seq asc limit 1000
create index if not exists events_user_seq_idx on public.events (user_id, seq);

-- --------------------------------------------------------- seq assignment
create or replace function public.assign_event_seq()
returns trigger
language plpgsql
-- SECURITY DEFINER: the counter table is closed to clients by RLS, so the
-- trigger has to run with the owner's rights to read and bump it.
security definer
-- Pin the schema: a definer function must never resolve names through a
-- caller-controlled search_path.
set search_path = public
as $$
declare
  next_seq bigint;
begin
  -- First push of a new account: create the counter. `do nothing` keeps two
  -- concurrent first-pushes from colliding.
  insert into public.sync_counters (user_id, last_seq)
  values (new.user_id, 0)
  on conflict (user_id) do nothing;

  -- THE LOCK. Held until this transaction commits or rolls back, which is what
  -- makes commit order equal seq order (invariant 2).
  select last_seq + 1 into next_seq
  from public.sync_counters
  where user_id = new.user_id
  for update;

  update public.sync_counters set last_seq = next_seq where user_id = new.user_id;

  new.seq := next_seq;
  return new;
end;
$$;

drop trigger if exists events_assign_seq on public.events;
create trigger events_assign_seq
  before insert on public.events
  for each row
  execute function public.assign_event_seq();

-- ------------------------------------------------------------------- RLS
alter table public.events        enable row level security;
alter table public.sync_counters enable row level security;

-- A signed-in user can read exactly their own rows...
drop policy if exists events_select_own on public.events;
create policy events_select_own on public.events
  for select using (auth.uid() = user_id);

-- ...and insert rows only under their own user_id. `upsert(..., {onConflict:
-- 'user_id,id', ignoreDuplicates: true})` compiles to INSERT ... ON CONFLICT DO
-- NOTHING, so it needs nothing more than this policy.
drop policy if exists events_insert_own on public.events;
create policy events_insert_own on public.events
  for insert with check (auth.uid() = user_id);

-- NO UPDATE POLICY AND NO DELETE POLICY — ON PURPOSE.
-- With RLS enabled, a missing policy means "denied for everyone". The log is
-- therefore append-only at the DATABASE level: a compromised client, or a bug
-- in ours, cannot rewrite or erase history it already pushed. Erasing data is
-- expressed the same way it is on-device — by appending a `data_cleared` event,
-- which every device folds into a wipe. Deleting the ACCOUNT still deletes the
-- rows, via `on delete cascade` from auth.users.

-- No policies at all on sync_counters: clients cannot see or touch the cursor
-- allocator. Only `assign_event_seq` (security definer) may.

-- ------------------------------------------------------------------ grants
-- PostgREST reaches the table as the `authenticated` role; RLS above then
-- narrows it to the caller's own rows. `anon` gets nothing: sync requires a
-- signed-in user.
grant usage on schema public to authenticated;
grant select, insert on public.events to authenticated;

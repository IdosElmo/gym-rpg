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

-- =====================================================================
--  GHOST DUEL (run this block if upgrading)
--  ---------------------------------------------------------------------
--  Everything above is the original sync schema. If your project already
--  has it, paste ONLY this block into the SQL editor and run it — every
--  statement below is idempotent (`if not exists`, `or replace`, and a
--  `drop policy if exists` before each `create policy`), so running it on
--  a fresh project or a second time is equally safe.
--
--  WHAT IT IS. A ghost is a SNAPSHOT of one account's character — the six
--  body-part levels, the streak tier, the equipped gear and its upgrade
--  levels, the body × skin being played, and a display name. Another
--  account looks it up by handle and fights it as a deterministic enemy.
--
--  THIS TABLE IS NOT THE EVENT LOG, and the difference is deliberate:
--
--    * `events` is APPEND-ONLY, private, and the single source of truth
--      for an account's own state. Nothing here ever folds back into it.
--    * `ghosts` is PRESENCE DATA: exactly one row per user, overwritten in
--      place on every publish, readable by everyone. Losing the whole
--      table costs each user one re-publish and nothing else — no history,
--      no progress, no coins are stored in it.
--
--  ---------------------------------------------------------------------
--  THE SHARING BOUNDARY — read this before changing the select policy
--  ---------------------------------------------------------------------
--  `ghosts_select_all` lets ANY SIGNED-IN USER read ANY row. That is not
--  an oversight: it IS the sharing mechanism. There is no server here (see
--  the header of this file), so "let my partner fight my character" has to
--  be expressible as a row somebody else may select.
--
--  What that exposes, in full:
--    * `handle`  — a display name the user chose and can change;
--    * `payload` — game stats and cosmetics only (levels, streak tier,
--                  item ids, upgrade levels, skin/body). The client builds
--                  it in `src/core/ghost.ts` and it deliberately contains
--                  NO workout history, NO dates, NO email, NO user id and
--                  NO coins;
--    * `updated_at` — when they last played.
--
--  What it does NOT expose: `user_id` is never selected by the client (see
--  GHOST_COLUMNS in `src/sync/supabaseBackend.ts`), and even if it were, it
--  is an opaque uuid that unlocks nothing — every policy on `events` is
--  scoped to `auth.uid()`, so knowing somebody's id grants no access to a
--  single one of their events.
--
--  The residual exposure is enumeration: a signed-in client can, in
--  principle, page through this table and collect handles + stats. That is
--  the accepted cost of a serverless "fight my friend", and it is bounded
--  by what a handle IS — a nickname, published on purpose, carrying only
--  what the game draws. Ordinary use never enumerates: lookups are by
--  EXACT handle (`.eq('handle', …).maybeSingle()`), so a wrong guess
--  returns nothing at all.
--
--  If you ever want to tighten this, the shape to reach for is a
--  `friendships` table plus `using (exists (select 1 from friendships …))`
--  — not a weaker payload, because the payload is already the minimum the
--  feature needs.
-- =====================================================================

create table if not exists public.ghosts (
  -- One row per user: the primary key IS the owner, so publishing is an
  -- upsert on `user_id` and an account can never accumulate ghosts.
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  -- The shareable name, typed by a human. UNIQUE: two accounts cannot
  -- answer to one handle, which is what makes an exact-match lookup mean
  -- exactly one character. The client canonicalises it first (trim,
  -- collapse spaces, lower-case Latin — see `src/core/handle.ts`), so the
  -- uniqueness here matches the uniqueness a user perceives.
  handle     text        not null unique,
  -- The versioned snapshot (`{v: 1, name, body, skin, parts, streakTier,
  -- equipped, upgrades, characterLevel}`). Stored opaquely on purpose: the
  -- database never interprets a payload, and the CLIENT treats every field
  -- of it as hostile input (`normalizeGhost` clamps levels to 1..99,
  -- upgrade levels to 0..3, and rejects unknown item/skin ids), because a
  -- row here is written by another client and can say anything.
  payload    jsonb       not null,
  updated_at timestamptz not null default now()
);

-- The only query a lookup ever runs. The unique constraint above already
-- provides the index; this is a no-op on any project where it does.
create index if not exists ghosts_handle_idx on public.ghosts (handle);

alter table public.ghosts enable row level security;

-- READ: every signed-in user, any row. This is the sharing mechanism —
-- see the boundary note above before narrowing or widening it.
drop policy if exists ghosts_select_all on public.ghosts;
create policy ghosts_select_all on public.ghosts
  for select to authenticated using (true);

-- WRITE: your own row, and only ever your own row. `with check` is what
-- stops a client inserting a ghost under somebody else's id; the `using`
-- clause on update stops it overwriting one.
drop policy if exists ghosts_insert_own on public.ghosts;
create policy ghosts_insert_own on public.ghosts
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists ghosts_update_own on public.ghosts;
create policy ghosts_update_own on public.ghosts
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- NO DELETE POLICY, like the event log: nothing needs deleting here (a
-- publish overwrites in place), and deleting the ACCOUNT still removes the
-- row through `on delete cascade`.

grant select, insert, update on public.ghosts to authenticated;

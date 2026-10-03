# Edge Functions

## `estimate-meal` — the Gemini proxy for the 🍽️ nutrition tracker

The app is a static public page, so it can hold no secret. The Gemini API key
therefore lives **only** in the Supabase project, as a function secret; the app
calls this function through supabase-js (`functions.invoke`), authenticated by
the signed-in user's JWT. **The key must never be committed to this repository
— not in code, not in docs, not in a `.env` file.**

### One-time deployment — dashboard (no CLI needed)

The same flow as running `schema.sql` in the SQL editor, one screen over:

1. **The secret** — Dashboard → **Edge Functions → Secrets** → *Add new secret*:
   name `GEMINI_API_KEY`, value = your key from Google AI Studio.
2. **The function** — Dashboard → **Edge Functions → Deploy a new function →
   Via Editor**: name it exactly `estimate-meal`, paste the whole of
   `estimate-meal/index.ts` from this folder, and deploy.
3. **JWT verification** — in the function's *Details* page, leave
   **Enforce JWT verification** ON (the default).
4. **Who may use it** — Dashboard → **Edge Functions → Secrets** → add
   `AI_ALLOWED_EMAIL_HASHES`: the SHA-256 digests (lowercase hex, comma-separated)
   of the emails allowed to spend the key — the same digests as
   `src/nutrition/aiAccess.ts`. The function verifies the caller with Supabase
   Auth and refuses everyone else (403), including the public anon key (401).
   **Without this secret nobody can use the estimator** (fails closed). Compute a
   digest with:

   ```bash
   node -e "console.log(require('crypto').createHash('sha256').update('ADDRESS@example.com'.trim().toLowerCase(),'utf8').digest('hex'))"
   ```

Redeploying after a code change is the same editor, edit → deploy. Changing the
secret takes effect without redeploying.

### One-time deployment — CLI (equivalent alternative)

```bash
supabase link --project-ref omiqettlrjbcafnmomrm
supabase secrets set GEMINI_API_KEY=<your key from Google AI Studio>
supabase secrets set AI_ALLOWED_EMAIL_HASHES=<digest1>,<digest2>
supabase functions deploy estimate-meal
```

Deploy with JWT verification **on** (the default — do not pass
`--no-verify-jwt`).

### Key hygiene

- In Google AI Studio / Cloud Console, restrict the key to the
  **Generative Language API** only.
- If the key was ever pasted into a chat, an issue, or any log, treat it as
  semi-exposed: rotate it and run `supabase secrets set GEMINI_API_KEY=…` again
  (takes effect without redeploying).

### Contract

`POST` body `{ text: string, photo?: { mimeType: string, base64: string }, catalog?: string[] }` →
`200` with:

```
{ calories, protein_g, confidence: 'low'|'medium'|'high', reason,
  items: [{ name, quantity, grams, kcal, protein_g, assumed }] }
```

`catalog` is the app's built-in food catalog (`src/data/foods.ts`) as prompt
lines — one per food, one per fixed meal. The function treats it as a hint
stronger than its own anchors, used only on a clear match (a fixed meal named
in the text expands to its components). Because the app sends it, a catalog
change needs no redeploy; an older function build simply ignores the field.

The answer is **itemized**: the model returns one line per ingredient (grams,
kcal/100 g, protein/100 g), the function does the arithmetic, and `calories` /
`protein_g` are the sums of `items`. `assumed` marks a line whose quantity the
description did not state; `confidence` is capped by how many lines are
assumed (any ⇒ at most `medium`; half or more, or a weightless line ⇒ `low`),
and `reason` names them. Common Israeli staples are pinned to the `ANCHORS`
table in `index.ts` so they price identically on every call; the request runs
at `temperature: 0` with a fixed `seed`. The client re-validates and re-sums in
`src/nutrition/aiPort.ts`, and still accepts the older name-only `items`.

Errors: `400` bad input, `413` photo too large, `429` rate limited, `500`
secret missing, `502` Gemini unreachable or unreadable. The model
(`gemini-3.5-flash`) is a constant in `index.ts` — changing it is a redeploy,
never an app release.

### Reproducibility check (after deploying)

Paste the same multi-line meal three times and press ✨ each time: the numbers
must be identical, the breakdown must list every ingredient, and lines without
a stated quantity must carry the ⚠️ badge with confidence at most `medium`.
Add the missing quantities to the text → badges gone, confidence `high`.

## `meal-reminders` — the 🔔 push reminders of the 🍽️ nutrition tracker

Once an hour a `pg_cron` job POSTs this function; for every device that turned
reminders on it checks the device's local hour, and at the start of a meal
window (08:00, 10:00, 12:00, 16:00, 18:00 — the app's `MEAL_SLOTS`) pushes
"🍽️ ארוחת בוקר · החלון פתוח עד 10:00 · הצעה מהתפריט: …" — unless something is
already logged in that meal today. The windows and the suggestions come from
the app (uploaded with each subscription), so the function hardcodes neither.

### One-time setup

1. **Keys.** On your own computer: `npx web-push generate-vapid-keys`. It
   prints a Public Key and a Private Key. Also make a random secret for the
   cron job, e.g. `openssl rand -hex 32`.
2. **Secrets** (Dashboard → Edge Functions → Secrets):
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` + your
   email) and `CRON_SECRET` (the random secret).
3. **Deploy** (Dashboard → Edge Functions → Deploy a new function → Via
   Editor): name it exactly `meal-reminders`, paste
   `supabase/functions/meal-reminders/index.ts`, deploy. Then in the function's
   settings turn **Enforce JWT verification OFF** — the caller is the cron job,
   and `CRON_SECRET` is the lock instead.
4. **Database** (SQL Editor): run `supabase/reminders.sql` — first put the
   `CRON_SECRET` value in place of `PASTE_CRON_SECRET_HERE`.
5. **The app**: the Public Key goes into `PUSH_VAPID_PUBLIC_KEY` in
   `src/sync/config.ts` (it is public by design). Until it is set, the
   reminders card does not exist.
6. **On each phone**: 🍽️ תזונה → 🔔 תזכורות לארוחות → הפעלת תזכורות, and allow
   notifications. On Android, use Chrome with the app added to the home screen.

### Test it

```bash
curl -X POST https://omiqettlrjbcafnmomrm.supabase.co/functions/v1/meal-reminders \
  -H "x-cron-secret: <CRON_SECRET>" -H "content-type: application/json" \
  -d '{"test": true}'
```

Every subscribed device gets a "🔔 בדיקה" notification at once; the answer is
`{ sent, skipped, removed, test }`. Dashboard → Edge Functions →
meal-reminders → Logs shows the hourly runs. A device whose subscription the
browser dropped (`404`/`410`) is deleted from the table automatically.

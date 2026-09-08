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
   **Enforce JWT verification** ON (the default): only signed-in users of this
   project may spend the key.

Redeploying after a code change is the same editor, edit → deploy. Changing the
secret takes effect without redeploying.

### One-time deployment — CLI (equivalent alternative)

```bash
supabase link --project-ref omiqettlrjbcafnmomrm
supabase secrets set GEMINI_API_KEY=<your key from Google AI Studio>
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

`POST` body `{ text: string, photo?: { mimeType: string, base64: string } }` →
`200` with:

```
{ calories, protein_g, confidence: 'low'|'medium'|'high', reason,
  items: [{ name, quantity, grams, kcal, protein_g, assumed }] }
```

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

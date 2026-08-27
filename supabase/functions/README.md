# Edge Functions

## `estimate-meal` — the Gemini proxy for the 🍽️ nutrition tracker

The app is a static public page, so it can hold no secret. The Gemini API key
therefore lives **only** in the Supabase project, as a function secret; the app
calls this function through supabase-js (`functions.invoke`), authenticated by
the signed-in user's JWT. **The key must never be committed to this repository
— not in code, not in docs, not in a `.env` file.**

### One-time deployment (from the owner's machine)

```bash
supabase link --project-ref omiqettlrjbcafnmomrm
supabase secrets set GEMINI_API_KEY=<your key from Google AI Studio>
supabase functions deploy estimate-meal
```

Deploy with JWT verification **on** (the default — do not pass
`--no-verify-jwt`): only signed-in users of this project may spend the key.

### Key hygiene

- In Google AI Studio / Cloud Console, restrict the key to the
  **Generative Language API** only.
- If the key was ever pasted into a chat, an issue, or any log, treat it as
  semi-exposed: rotate it and run `supabase secrets set GEMINI_API_KEY=…` again
  (takes effect without redeploying).

### Contract

`POST` body `{ text: string, photo?: { mimeType: string, base64: string } }` →
`200` with `{ calories, protein_g, items, confidence }` (already normalized;
the client re-validates in `src/nutrition/aiPort.ts`). Errors: `400` bad input,
`413` photo too large, `429` rate limited, `500` secret missing, `502` Gemini
unreachable or unreadable. The model (`gemini-3.5-flash-lite`) is a constant in
`index.ts` — changing it is a redeploy, never an app release.

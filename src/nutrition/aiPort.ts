/**
 * nutrition/aiPort.ts — the calorie-estimation seam.
 *
 * The same move as sync/backend.ts: the UI talks to a small interface, tests
 * implement it in memory, and exactly ONE thin module in the composition root
 * (`edgePort.ts`, wired from main.ts) actually reaches a network — through the
 * user's own Supabase project, whose Edge Function `estimate-meal` holds the
 * Gemini API key as a SERVER-SIDE secret. No key ever exists in this bundle,
 * in localStorage, in the event log or in an export, and `npm run verify`
 * stays untouched: the only origin involved is the already-allowlisted
 * configured Supabase project, with the URL built by supabase-js.
 *
 * The pure halves (`parseEstimate`, `mapInvokeError`) live here so they can be
 * unit-tested without any port at all — the repo mocks no fetch, ever.
 */

/** What the user gives the estimator. The photo is ALREADY downscaled+encoded. */
export interface MealEstimateRequest {
  /** Hebrew free-text description; may be '' when a photo carries the meal. */
  text: string;
  photo?: { mimeType: string; base64: string };
}

/** What the Edge Function answers with (already normalized server-side). */
export interface MealEstimate {
  calories: number;
  proteinG: number;
  /** What the model thought the meal contains ("אורז", "חזה עוף"…). */
  items: string[];
  confidence: 'low' | 'medium' | 'high';
}

export type EstimateError =
  /** No signed-in session — the Edge Function requires the account's JWT. */
  | 'signed_out'
  /** The device is offline (the invoke threw before an HTTP status existed). */
  | 'offline'
  /** Too many requests — Gemini or the function said slow down. */
  | 'rate_limited'
  /** Any other HTTP failure. */
  | 'http'
  /** The response arrived but did not read as an estimate. */
  | 'unparseable';

export type EstimateResult = { ok: true; estimate: MealEstimate } | { ok: false; error: EstimateError };

export interface NutritionAiPort {
  /** True when estimation can be offered AT ALL (signed in to a configured project). */
  configured(): boolean;
  estimate(req: MealEstimateRequest): Promise<EstimateResult>;
}

/* ------------------------------------------------------------ pure halves */

const CONFIDENCES = ['low', 'medium', 'high'] as const;
const MAX_ITEMS = 10;
const MAX_ITEM_LEN = 60;
const MAX_CALORIES = 10000;
const MAX_PROTEIN = 500;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clampNum(v: unknown, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n < 0 ? 0 : n > max ? max : n;
}

/**
 * Read the Edge Function's `{calories, protein_g, items, confidence}` answer
 * into a `MealEstimate`, or `null` when it does not parse. The server already
 * normalized once; this clamps AGAIN with the tracker's own limits, because a
 * response that crossed a network is untrusted by the same rule a synced
 * payload is.
 */
export function parseEstimate(raw: unknown): MealEstimate | null {
  if (!isRecord(raw)) return null;
  const calories = clampNum(raw['calories'], MAX_CALORIES);
  const proteinG = clampNum(raw['protein_g'], MAX_PROTEIN);
  if (calories === null || proteinG === null) return null;
  const confidence = CONFIDENCES.includes(raw['confidence'] as (typeof CONFIDENCES)[number])
    ? (raw['confidence'] as MealEstimate['confidence'])
    : 'low';
  const items: string[] = [];
  if (Array.isArray(raw['items'])) {
    for (const it of raw['items']) {
      if (typeof it === 'string' && it.trim()) items.push(it.trim().slice(0, MAX_ITEM_LEN));
      if (items.length >= MAX_ITEMS) break;
    }
  }
  return { calories, proteinG, items, confidence };
}

/** Classify a failed invoke by its HTTP status. */
export function mapInvokeError(status: number): EstimateError {
  if (status === 401 || status === 403) return 'signed_out';
  if (status === 429) return 'rate_limited';
  return 'http';
}

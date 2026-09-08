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
 * WHY THE ANSWER IS ITEMIZED. A model asked for one total GUESSES it, and two
 * guesses at the same meal differed by 25%. Asked instead for one line per
 * ingredient — grams, kcal per 100 g, protein per 100 g — it is answering the
 * questions it is actually good at, and the arithmetic happens HERE, in code
 * (`totalsOf`), not in its head. The number on screen is therefore the sum of
 * the breakdown the user can read, line by line, and the confidence is capped
 * by something MEASURABLE (`capConfidence`: how many quantities had to be
 * assumed), not only by the model's opinion of itself.
 *
 * The pure halves live here so they can be unit-tested without any port at
 * all — the repo mocks no fetch, ever.
 */

/** What the user gives the estimator. The photo is ALREADY downscaled+encoded. */
export interface MealEstimateRequest {
  /** Hebrew free-text description; may be '' when a photo carries the meal. */
  text: string;
  photo?: { mimeType: string; base64: string };
}

export type Confidence = 'low' | 'medium' | 'high';

/**
 * One line of the breakdown. The numbers are `null` for an answer from an
 * older function build that only named the ingredients (legacy string items).
 */
export interface EstimateItem {
  /** Hebrew ingredient name ("דף אורז", "טונה במים"). */
  name: string;
  /** The quantity as understood ("4 דפים", "חצי"), '' when none was given. */
  quantity: string;
  grams: number | null;
  kcal: number | null;
  proteinG: number | null;
  /** The description gave no usable quantity — the model picked a standard portion. */
  assumed: boolean;
}

/** What the estimator answers with — totals, breakdown, and an honest confidence. */
export interface MealEstimate {
  calories: number;
  proteinG: number;
  items: EstimateItem[];
  confidence: Confidence;
  /** Why the confidence is not high (Hebrew, one sentence). Absent when it is. */
  reason?: string;
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

const CONFIDENCES: readonly Confidence[] = ['low', 'medium', 'high'];
const RANK: Readonly<Record<Confidence, number>> = { low: 0, medium: 1, high: 2 };
const MAX_ITEMS = 20;
const MAX_ITEM_LEN = 60;
const MAX_REASON_LEN = 200;
const MAX_CALORIES = 10000;
const MAX_PROTEIN = 500;
/** Per-line sanity: nobody eats 2 kg of one ingredient, and nothing beats pure fat. */
const MAX_ITEM_GRAMS = 2000;
const MAX_ITEM_KCAL = 2000;
const MAX_ITEM_PROTEIN = 500;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clampNum(v: unknown, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n < 0 ? 0 : n > max ? max : n;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Read one breakdown line — an object from the itemized function, or a bare legacy name. */
function itemOf(raw: unknown): EstimateItem | null {
  if (typeof raw === 'string') {
    const name = str(raw, MAX_ITEM_LEN);
    return name ? { name, quantity: '', grams: null, kcal: null, proteinG: null, assumed: false } : null;
  }
  if (!isRecord(raw)) return null;
  const name = str(raw['name'], MAX_ITEM_LEN);
  if (!name) return null;
  return {
    name,
    quantity: str(raw['quantity'], MAX_ITEM_LEN),
    grams: clampNum(raw['grams'], MAX_ITEM_GRAMS),
    kcal: clampNum(raw['kcal'], MAX_ITEM_KCAL),
    proteinG: clampNum(raw['protein_g'], MAX_ITEM_PROTEIN),
    assumed: raw['assumed'] === true,
  };
}

/**
 * Sum the breakdown — THE numbers the screen shows when every line carries
 * them. `null` when any line is number-less (a legacy answer, or a line the
 * server could not price), so the caller falls back to the server's totals
 * rather than showing a partial sum as if it were the whole meal.
 */
export function totalsOf(items: readonly EstimateItem[]): { calories: number; proteinG: number } | null {
  if (items.length === 0) return null;
  let calories = 0;
  let proteinG = 0;
  for (const it of items) {
    if (it.kcal === null || it.proteinG === null) return null;
    calories += it.kcal;
    proteinG += it.proteinG;
  }
  return { calories: Math.min(MAX_CALORIES, calories), proteinG: Math.min(MAX_PROTEIN, proteinG) };
}

/**
 * The confidence the breakdown SUPPORTS, whatever the model claimed: any
 * assumed quantity caps it at medium; half or more assumed, or a line with no
 * weight at all, caps it at low. The model's own word can only lower it further.
 */
export function capConfidence(items: readonly EstimateItem[], model: Confidence): Confidence {
  const priced = items.filter((it) => it.grams !== null);
  if (priced.length === 0) return model;
  const assumed = priced.filter((it) => it.assumed).length;
  const weightless = priced.some((it) => it.grams === 0);
  const cap: Confidence = weightless || assumed * 2 >= priced.length ? 'low' : assumed > 0 ? 'medium' : 'high';
  return RANK[model] < RANK[cap] ? model : cap;
}

/**
 * Read the Edge Function's answer into a `MealEstimate`, or `null` when it does
 * not parse. Accepts BOTH the itemized shape (`items` as objects with grams /
 * kcal / protein) and the older name-only shape (`items` as strings), so the
 * app and the function can be updated in either order. Clamps AGAIN with the
 * tracker's own limits: a response that crossed a network is untrusted by the
 * same rule a synced payload is.
 */
export function parseEstimate(raw: unknown): MealEstimate | null {
  if (!isRecord(raw)) return null;
  const items: EstimateItem[] = [];
  if (Array.isArray(raw['items'])) {
    for (const it of raw['items']) {
      const item = itemOf(it);
      if (item) items.push(item);
      if (items.length >= MAX_ITEMS) break;
    }
  }
  const fromItems = totalsOf(items);
  const serverCalories = clampNum(raw['calories'], MAX_CALORIES);
  const serverProtein = clampNum(raw['protein_g'], MAX_PROTEIN);
  if (!fromItems && (serverCalories === null || serverProtein === null)) return null;
  const calories = fromItems ? fromItems.calories : (serverCalories as number);
  const proteinG = fromItems ? fromItems.proteinG : (serverProtein as number);
  const claimed: Confidence = CONFIDENCES.includes(raw['confidence'] as Confidence)
    ? (raw['confidence'] as Confidence)
    : 'low';
  const confidence = capConfidence(items, claimed);
  const reason = str(raw['reason'], MAX_REASON_LEN);
  return { calories, proteinG, items, confidence, ...(reason ? { reason } : {}) };
}

/** Classify a failed invoke by its HTTP status. */
export function mapInvokeError(status: number): EstimateError {
  if (status === 401 || status === 403) return 'signed_out';
  if (status === 429) return 'rate_limited';
  return 'http';
}

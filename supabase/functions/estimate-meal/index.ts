/**
 * estimate-meal — the Gemini proxy for the 🍽️ nutrition tracker.
 *
 * WHY A FUNCTION AT ALL: the app is a static, public, single-file page — a
 * secret cannot live in it, by definition. So the Gemini API key lives HERE, as
 * a Supabase secret (`GEMINI_API_KEY`), and the app talks only to its own
 * Supabase project. Deploy with JWT verification ON (the default): only a
 * signed-in user of this project can spend the key.
 *
 * WHY THE ANSWER IS ITEMIZED AND COLD. The first version asked the model for
 * one total and got 610 kcal one minute and 480 the next for the same text —
 * both "high" confidence. Three causes, all fixed here:
 *   1. no `temperature`/`seed` → the numbers themselves were sampled;
 *   2. one-shot totals → the model summed eight items in its head;
 *   3. self-reported confidence → an opinion, not a measurement.
 * Now the model returns one line per ingredient (grams, kcal/100 g,
 * protein/100 g), common Israeli staples are pinned to the ANCHORS table so
 * they price identically every time, the arithmetic is done in code, and the
 * confidence is CAPPED by how many quantities had to be assumed.
 *
 * Request  (POST, JSON): { text: string, photo?: { mimeType: string, base64: string } }
 * Response (200,  JSON): { calories, protein_g, confidence: 'low'|'medium'|'high', reason,
 *                          items: [{ name, quantity, grams, kcal, protein_g, assumed }] }
 * Errors: 400 bad input · 413 photo too large · 429 rate limited (Gemini said
 * so) · 500 key missing · 502 Gemini unreachable/unreadable.
 *
 * This file is DENO code, deployed from the Supabase dashboard editor — it is
 * not part of the Vite bundle, not typechecked by the app's tsconfig and never
 * reachable from the offline build. It is ONE file on purpose (paste-deploy).
 */

const MODEL = 'gemini-3.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_TEXT_LEN = 1000;
/** ~1MB of base64 ≈ 750KB of JPEG — far above what a 1024px meal photo needs. */
const MAX_PHOTO_B64 = 1_400_000;
const MAX_ITEMS = 20;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/* ---------------------------------------------------------------- anchors */

interface Anchor {
  /** Every spelling the model may meet. The first is the canonical name. */
  names: string[];
  /** Household units and their weight in grams ("כף" → 15). */
  units: Record<string, number>;
  /** Per 100 g, as eaten. Sources: USDA FoodData Central / משרד הבריאות tables. */
  kcal100: number;
  protein100: number;
}

/**
 * Israeli staples pinned to fixed values, so "דף אורז" or "כף סילאן" price
 * identically on every request instead of drifting with the model's mood.
 * Keep it SHORT and common: the model handles everything else on its own.
 */
const ANCHORS: Anchor[] = [
  { names: ['דף אורז', 'דפי אורז'], units: { 'דף': 9, 'יחידה': 9 }, kcal100: 330, protein100: 3.5 },
  { names: ['ביצה', 'ביצים', 'ביצה קשה', 'ביצים קשות', 'ביצת עין', 'ביצה מקושקשת'], units: { 'יחידה': 55 }, kcal100: 143, protein100: 12.6 },
  { names: ['חלבון ביצה', 'חלבוני ביצה'], units: { 'יחידה': 33 }, kcal100: 52, protein100: 11 },
  { names: ['סילאן'], units: { 'כף': 20, 'כפית': 7 }, kcal100: 300, protein100: 1 },
  { names: ['דבש'], units: { 'כף': 21, 'כפית': 7 }, kcal100: 304, protein100: 0.3 },
  { names: ['שמן זית', 'שמן'], units: { 'כף': 13.5, 'כפית': 4.5 }, kcal100: 884, protein100: 0 },
  { names: ['טונה במים', 'טונה במים מסוננת'], units: { 'כף גדושה': 25, 'כף': 20, 'קופסה': 110 }, kcal100: 116, protein100: 26 },
  { names: ['טונה בשמן', 'טונה בשמן מסוננת'], units: { 'כף גדושה': 25, 'כף': 20, 'קופסה': 110 }, kcal100: 190, protein100: 27 },
  { names: ['מיונז'], units: { 'כף': 15, 'כפית': 5 }, kcal100: 680, protein100: 1 },
  { names: ['מיונז דל שומן', 'מיונז לייט', 'מיונז דיאט'], units: { 'כף': 15, 'כפית': 5 }, kcal100: 330, protein100: 1 },
  { names: ['אבוקדו'], units: { 'חצי קטן': 60, 'חצי': 85, 'חצי בינוני': 85, 'יחידה': 170 }, kcal100: 160, protein100: 2 },
  { names: ['עגבניות מרוסקות', 'רסק עגבניות ביתי', 'רוטב עגבניות'], units: { 'כוס': 240, 'כף': 15 }, kcal100: 30, protein100: 1.3 },
  { names: ['עגבנייה', 'עגבניה', 'עגבניות'], units: { 'יחידה': 120 }, kcal100: 18, protein100: 0.9 },
  { names: ['עגבניות שרי', 'עגבניית שרי'], units: { 'יחידה': 15 }, kcal100: 18, protein100: 0.9 },
  { names: ['מלפפון', 'מלפפונים'], units: { 'יחידה': 100 }, kcal100: 15, protein100: 0.7 },
  { names: ['גזר'], units: { 'יחידה': 70 }, kcal100: 41, protein100: 0.9 },
  { names: ['קולורבי'], units: { 'יחידה': 150 }, kcal100: 27, protein100: 1.7 },
  { names: ['פטריות', 'פטריות שמפיניון'], units: { 'כוס': 70, 'יחידה': 18 }, kcal100: 22, protein100: 3.1 },
  { names: ['תרד', 'עלי תרד'], units: { 'כוס': 30, 'חופן': 25 }, kcal100: 23, protein100: 2.9 },
  { names: ['חסה', 'עלים', 'עלי סלט', 'עלים ירוקים'], units: { 'כוס': 40, 'חופן': 30 }, kcal100: 15, protein100: 1.4 },
  { names: ['סלט ירקות', 'סלט'], units: { 'קערה': 200, 'מנה': 150 }, kcal100: 22, protein100: 1.2 },
  { names: ['לחם אחיד', 'לחם לבן', 'לחם'], units: { 'פרוסה': 30 }, kcal100: 265, protein100: 8.5 },
  { names: ['לחם מלא', 'לחם שיפון', 'לחם קל'], units: { 'פרוסה': 35 }, kcal100: 250, protein100: 9 },
  { names: ['פיתה'], units: { 'יחידה': 60 }, kcal100: 275, protein100: 9 },
  { names: ['לחמנייה', 'לחמניה'], units: { 'יחידה': 60 }, kcal100: 290, protein100: 9 },
  { names: ['קוטג׳', "קוטג'", 'קוטג', 'גבינת קוטג׳'], units: { 'כף': 30, 'גביע': 250 }, kcal100: 95, protein100: 11 },
  { names: ['גבינה לבנה', 'גבינה לבנה 5%'], units: { 'כף': 30, 'גביע': 250 }, kcal100: 90, protein100: 8 },
  { names: ['גבינה צהובה', 'גבינה צהובה 28%'], units: { 'פרוסה': 25 }, kcal100: 330, protein100: 25 },
  { names: ['יוגורט', 'יוגורט 3%'], units: { 'גביע': 150 }, kcal100: 65, protein100: 4 },
  { names: ['חלב', 'חלב 3%'], units: { 'כוס': 240 }, kcal100: 60, protein100: 3.3 },
  { names: ['אורז מבושל', 'אורז לבן מבושל', 'אורז'], units: { 'כוס': 160, 'כף': 20 }, kcal100: 130, protein100: 2.7 },
  { names: ['פסטה מבושלת', 'פסטה'], units: { 'כוס': 140, 'כף': 20 }, kcal100: 160, protein100: 6 },
  { names: ['חומוס', 'ממרח חומוס'], units: { 'כף': 25 }, kcal100: 180, protein100: 7 },
  { names: ['טחינה', 'טחינה גולמית'], units: { 'כף': 15, 'כפית': 5 }, kcal100: 600, protein100: 17 },
  { names: ['חזה עוף', 'חזה עוף צלוי', 'חזה עוף מבושל'], units: { 'חתיכה': 120, 'מנה': 150 }, kcal100: 165, protein100: 31 },
  { names: ['בשר טחון', 'בשר בקר טחון'], units: { 'מנה': 150 }, kcal100: 220, protein100: 26 },
  { names: ['סלמון', 'פילה סלמון'], units: { 'מנה': 130 }, kcal100: 208, protein100: 22 },
  { names: ['שקדים'], units: { 'יחידה': 1.2, 'חופן': 30 }, kcal100: 580, protein100: 21 },
  { names: ['בננה'], units: { 'יחידה': 120 }, kcal100: 89, protein100: 1.1 },
  { names: ['תפוח', 'תפוח עץ'], units: { 'יחידה': 180 }, kcal100: 52, protein100: 0.3 },
  { names: ['שיבולת שועל', 'קוואקר'], units: { 'כף': 10, 'כוס': 90 }, kcal100: 380, protein100: 13 },
  { names: ['חמאת בוטנים'], units: { 'כף': 16, 'כפית': 6 }, kcal100: 590, protein100: 25 },
  { names: ['מלח', 'פלפל', 'מלח ופלפל', 'תבלינים'], units: { 'קורט': 1 }, kcal100: 0, protein100: 0 },
];

function anchorLines(): string {
  return ANCHORS.map((a) => {
    const units = Object.entries(a.units)
      .map(([u, g]) => `${u}=${g} ג׳`)
      .join(', ');
    return `- ${a.names[0]} (${a.names.slice(1).join(' / ') || '—'}): ${units}; ${a.kcal100} קק״ל ו-${a.protein100} ג׳ חלבון ל-100 ג׳`;
  }).join('\n');
}

/* ----------------------------------------------------------------- prompt */

const PROMPT =
  'אתה עוזר תזונה מדויק ועקבי. פרק את הארוחה המתוארת בטקסט ו/או בתמונה לרכיבים, והחזר JSON בלבד לפי הסכמה.\n\n' +
  'שיטת העבודה, לפי הסדר:\n' +
  '1. פצל את הארוחה לרכיבים — שורה לכל מרכיב. שמנים, ממרחים ורטבים הם שורות נפרדות.\n' +
  '2. לכל רכיב קבע משקל בגרמים (grams) מתוך הכמות שצוינה בטקסט. אם הרכיב מופיע בטבלת העוגן למטה — ' +
  'השתמש במשקלי היחידות שלה בדיוק. אחרת השתמש במנה ישראלית סטנדרטית.\n' +
  '3. לכל רכיב קבע kcal_per_100g ו-protein_per_100g. אם הרכיב מופיע בטבלת העוגן — השתמש בערכיה בדיוק. ' +
  'אחרת השתמש בערכים תזונתיים סטנדרטיים למזון כפי שהוא נאכל (מבושל/צלוי/גולמי לפי התיאור).\n' +
  '4. אל תחשב סכומים — החישוב נעשה בקוד.\n' +
  '5. הטקסט קובע: כמויות שצוינו במילים גוברות על מה שנראה בתמונה. התמונה משלימה רק מה שהטקסט לא אמר.\n' +
  '6. assumed=true רק כשלרכיב לא צוינה כמות שמישה והנחת מנה סטנדרטית. quantity = הכמות כפי שהבנת אותה ("4 דפים", "חצי", "כף גדושה").\n' +
  '7. confidence: high כשכל הכמויות צוינו וכל הרכיבים מזוהים; medium כשחלק מהכמויות הונחו; low כשרוב הכמויות הונחו או רכיב לא זוהה. ' +
  'reason: משפט קצר בעברית שמונה את הרכיבים שהכמות שלהם הונחה או שלא זוהו; מחרוזת ריקה כשהדיוק גבוה.\n\n' +
  'טבלת עוגן (משקלי יחידות וערכים ל-100 ג׳):\n' + anchorLines();

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          quantity: { type: 'STRING' },
          grams: { type: 'NUMBER' },
          kcal_per_100g: { type: 'NUMBER' },
          protein_per_100g: { type: 'NUMBER' },
          assumed: { type: 'BOOLEAN' },
        },
        required: ['name', 'quantity', 'grams', 'kcal_per_100g', 'protein_per_100g', 'assumed'],
      },
    },
    confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
    reason: { type: 'STRING' },
  },
  required: ['items', 'confidence', 'reason'],
};

/* ---------------------------------------------------------------- helpers */

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

function num(v: unknown, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v < 0 ? 0 : v > max ? max : v;
}

type Confidence = 'low' | 'medium' | 'high';
const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

interface Line {
  name: string;
  quantity: string;
  grams: number;
  kcal: number;
  protein_g: number;
  assumed: boolean;
}

/** One model line → one priced line, or null when it is not an ingredient. */
function lineOf(raw: unknown): Line | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 60) : '';
  if (!name) return null;
  const grams = num(r.grams, 2000) ?? 0;
  const kcal100 = num(r.kcal_per_100g, 900) ?? 0;
  const protein100 = num(r.protein_per_100g, 100) ?? 0;
  return {
    name,
    quantity: typeof r.quantity === 'string' ? r.quantity.trim().slice(0, 60) : '',
    grams: Math.round(grams),
    kcal: Math.round((grams * kcal100) / 100),
    protein_g: Math.round((grams * protein100) / 100),
    assumed: r.assumed === true,
  };
}

/** The confidence the breakdown supports; the model's word can only lower it. */
function capConfidence(lines: Line[], claimed: Confidence): Confidence {
  if (lines.length === 0) return claimed;
  const assumed = lines.filter((l) => l.assumed).length;
  const weightless = lines.some((l) => l.grams === 0);
  const cap: Confidence = weightless || assumed * 2 >= lines.length ? 'low' : assumed > 0 ? 'medium' : 'high';
  return RANK[claimed] < RANK[cap] ? claimed : cap;
}

/* ----------------------------------------------------------------- server */

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json(500, { error: 'GEMINI_API_KEY is not set' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid JSON' });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const text = typeof b.text === 'string' ? b.text.trim().slice(0, MAX_TEXT_LEN) : '';
  const photo = (b.photo ?? null) as { mimeType?: unknown; base64?: unknown } | null;
  const mimeType = photo && typeof photo.mimeType === 'string' ? photo.mimeType : '';
  const base64 = photo && typeof photo.base64 === 'string' ? photo.base64 : '';
  if (!text && !base64) return json(400, { error: 'text or photo required' });
  if (base64 && !mimeType.startsWith('image/')) return json(400, { error: 'photo must be an image' });
  if (base64.length > MAX_PHOTO_B64) return json(413, { error: 'photo too large' });

  const parts: Record<string, unknown>[] = [{ text: `${PROMPT}\n\nתיאור הארוחה:\n${text || '(רק תמונה)'}` }];
  if (base64) parts.push({ inline_data: { mime_type: mimeType, data: base64 } });

  const geminiReq = {
    contents: [{ parts }],
    generationConfig: {
      // COLD AND SEEDED: the same description must price the same way twice.
      temperature: 0,
      topK: 1,
      seed: 1,
      response_mime_type: 'application/json',
      response_schema: RESPONSE_SCHEMA,
    },
  };

  let res: Response;
  try {
    res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(geminiReq),
    });
  } catch {
    return json(502, { error: 'gemini unreachable' });
  }
  if (res.status === 429) return json(429, { error: 'rate limited' });
  if (!res.ok) return json(502, { error: `gemini ${res.status}` });

  try {
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const lines: Line[] = [];
    if (Array.isArray(parsed.items)) {
      for (const it of parsed.items) {
        const line = lineOf(it);
        if (line) lines.push(line);
        if (lines.length >= MAX_ITEMS) break;
      }
    }
    if (lines.length === 0) return json(502, { error: 'gemini answer unreadable' });

    // THE ARITHMETIC HAPPENS HERE, not in the model's head.
    const calories = Math.min(10000, lines.reduce((s, l) => s + l.kcal, 0));
    const proteinG = Math.min(500, lines.reduce((s, l) => s + l.protein_g, 0));

    const claimed: Confidence =
      parsed.confidence === 'high' || parsed.confidence === 'medium' ? parsed.confidence : 'low';
    const confidence = capConfidence(lines, claimed);
    let reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
    const assumedNames = lines.filter((l) => l.assumed).map((l) => l.name);
    if (confidence !== 'high' && assumedNames.length > 0 && !reason.includes(assumedNames[0])) {
      reason = `כמות לא צוינה: ${assumedNames.join(', ')}${reason ? '. ' + reason : ''}`;
    }
    return json(200, { calories, protein_g: proteinG, items: lines, confidence, reason: reason.slice(0, 200) });
  } catch {
    return json(502, { error: 'gemini answer unreadable' });
  }
});

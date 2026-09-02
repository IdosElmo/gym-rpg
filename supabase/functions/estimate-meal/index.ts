/**
 * estimate-meal — the Gemini proxy for the 🍽️ nutrition tracker.
 *
 * WHY A FUNCTION AT ALL: the app is a static, public, single-file page — a
 * secret cannot live in it, by definition. So the Gemini API key lives HERE, as
 * a Supabase secret (`GEMINI_API_KEY`), and the app talks only to its own
 * Supabase project. Deploy with JWT verification ON (the default): only a
 * signed-in user of this project can spend the key.
 *
 * Request  (POST, JSON): { text: string, photo?: { mimeType: string, base64: string } }
 * Response (200,  JSON): { calories: number, protein_g: number, items: string[],
 *                          confidence: 'low' | 'medium' | 'high',
 *                          reason: string  // why confidence < high; '' when high }
 * Errors: 400 bad input · 413 photo too large · 429 rate limited (Gemini said
 * so) · 500 key missing · 502 Gemini unreachable/unreadable.
 *
 * This file is DENO code, deployed with `supabase functions deploy` — it is not
 * part of the Vite bundle, not typechecked by the app's tsconfig and never
 * reachable from the offline build.
 */

const MODEL = 'gemini-3.5-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_TEXT_LEN = 1000;
/** ~1MB of base64 ≈ 750KB of JPEG — far above what a 1024px meal photo needs. */
const MAX_PHOTO_B64 = 1_400_000;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PROMPT =
  'אתה עוזר תזונה. העריך את הקלוריות והחלבון (בגרמים) של הארוחה המתוארת בטקסט ו/או בתמונה. ' +
  'החזר JSON בלבד לפי הסכמה: calories (מספר שלם), protein_g (מספר), items (רשימת רכיבים בעברית), ' +
  "confidence ('low'/'medium'/'high'), reason (משפט קצר בעברית שמסביר למה הדיוק אינו גבוה — " +
  'למשל כמות לא ברורה, רכיב שלא זוהה, אופן הכנה לא ידוע — ומחרוזת ריקה כשהדיוק גבוה). ' +
  'אם הכמות לא ברורה — הנח מנה אחת סבירה, הורד את ה-confidence וציין זאת ב-reason.';

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

function clamp(v: unknown, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n < 0 ? 0 : n > max ? max : n;
}

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

  const parts: Record<string, unknown>[] = [{ text: `${PROMPT}\n\nתיאור הארוחה: ${text || '(רק תמונה)'}` }];
  if (base64) parts.push({ inline_data: { mime_type: mimeType, data: base64 } });

  const geminiReq = {
    contents: [{ parts }],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: {
        type: 'OBJECT',
        properties: {
          calories: { type: 'INTEGER' },
          protein_g: { type: 'NUMBER' },
          items: { type: 'ARRAY', items: { type: 'STRING' } },
          confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
          reason: { type: 'STRING' },
        },
        required: ['calories', 'protein_g', 'items', 'confidence', 'reason'],
      },
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
    const calories = clamp(parsed.calories, 10000);
    const proteinG = clamp(parsed.protein_g, 500);
    if (calories === null || proteinG === null) return json(502, { error: 'gemini answer unreadable' });
    const items = Array.isArray(parsed.items)
      ? parsed.items.filter((it): it is string => typeof it === 'string' && it.trim() !== '').slice(0, 10)
      : [];
    const confidence = parsed.confidence === 'high' || parsed.confidence === 'medium' ? parsed.confidence : 'low';
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 200) : '';
    return json(200, { calories, protein_g: proteinG, items, confidence, reason });
  } catch {
    return json(502, { error: 'gemini answer unreadable' });
  }
});

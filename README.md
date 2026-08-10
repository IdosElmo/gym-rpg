# Gym RPG 💪

אפליקציית אימוני היפרטרופיה (3 ימים · A/B/C) בעברית, RTL, **100% אופליין** —
עם תשתית לשכבת משחק RPG שנבנית בשלבים הבאים.

> **סטטוס: Phase 0** — תשתית, מיגרציה, PWA ו‑CI.
> שכבת המשחק (XP, דמות, קרב) נוספת ב‑Phase 1‑3.

---

## הרצה, בנייה ופריסה

דרישות: Node 22, npm 10.

```bash
npm install        # התקנת תלויות
npm run dev        # שרת פיתוח (Vite) — http://localhost:5173
npm run build      # בדיקת טיפוסים + בנייה ל-dist/index.html (קובץ יחיד)
npm run preview    # תצוגה מקדימה של ה-build
npm test           # Vitest
npm run typecheck  # tsc --noEmit
npm run verify     # מוודא ש-dist/index.html ללא הפניות חיצוניות
```

### קובץ יחיד (file://)

`vite-plugin-singlefile` מטמיע את כל ה‑JS וה‑CSS לתוך `dist/index.html`.
אפשר להעתיק את הקובץ הזה לטלפון/מחשב ולפתוח אותו ישירות — הכול עובד, כולל
הטיימר, הצליל וההיסטוריה. אין שום בקשת רשת, פונט חיצוני או CDN בזמן ריצה.

**`base: './'`** — מכיוון שהכול מוטמע, לא נשארות כתובות נכסים; ההפניות היחסיות
היחידות הן קבצי ה‑PWA (`manifest.webmanifest`, `sw.js`, `icon.svg`) שיושבים ליד
`index.html`. `base` יחסי עובד גם ב‑GitHub Project Pages (תחת `/gym-rpg/`) וגם
ב‑`file://`; `'/gym-rpg/'` היה שובר את `file://` ו‑`'/'` היה שובר את Pages.

### פריסה ל‑GitHub Pages

`.github/workflows/deploy.yml` רץ על כל push ל‑`main`:
typecheck → tests → build → verify → `configure-pages` → `upload-pages-artifact`
→ `deploy-pages`.

בהגדרות המאגר: **Settings → Pages → Source: GitHub Actions**.

### PWA

* `public/manifest.webmanifest` — התקנה למסך הבית (standalone, RTL, עברית).
* `public/sw.js` — Service Worker שמקדים‑מטמין (precache) את הקובץ הבנוי,
  cache‑first עם רענון ברקע ו‑fallback ל‑`index.html` בניווט.
* `public/icon.svg` — אייקון SVG (משקולת + דמות) על רקע `#121824`.
* רישום ה‑SW מוגן: הוא נרשם **רק** ב‑`http`/`https`, כך שגרסת הקובץ היחיד
  ב‑`file://` ממשיכה לעבוד.

---

## מודל הנתונים

### ארכיטקטורה

```
index.html               # שלד ה-DOM (טאבים, header, main, טיימר צף, toast)
styles/                  # CSS מפוצל לקבצים; אותם design tokens כמו במקור
src/
  data/program.ts        # תוכנית 3 הימים — הועתקה מילה במילה מהאפליקציה הישנה
  data/gameContent.ts    # (Phase 2-3) אויבים, בוסים, עולמות, ציוד
  storage/DataStore.ts   # ממשק אחסון מופשט: getState/save/update/subscribe/append
  storage/LocalStore.ts  # מימוש localStorage — המודול היחיד שנוגע ב-localStorage
  storage/migrate.ts     # גרסאות סכימה, מיגרציות, ייבוא נתונים ישנים, replay
  core/workout.ts        # מצב אימון, חיפוש ביצוע קודם
  core/xp.ts             # (Phase 1) נוסחאות XP, רמות, רצפים
  core/combat.ts         # (Phase 2) לולאת קרב דטרמיניסטית
  core/balance.ts        # קבועי איזון — מקור אמת יחיד למספרים
  ui/                    # מסכים: workout, history, timer, toast, app shell
  main.ts                # חיווט (composition root) + רישום Service Worker
tests/                   # Vitest
legacy/index.html        # האפליקציה המקורית, נשמרה כפי שהיא
```

### מפתחות אחסון

| מפתח | תוכן |
|---|---|
| `gymrpg_state_v1` | תמונת מצב נוכחית (`AppState`) |
| `gymrpg_events_v1` | יומן אירועים append‑only |
| `hyp3_data_v1` | הנתונים הישנים — נקראים פעם אחת לייבוא, **לא נמחקים** |
| `hyp3_ui_v1` | מצב UI ישן (טאב נבחר, כרטיסים פתוחים) |

### `AppState`

```ts
{
  schemaVersion: 1,
  sessions: {                       // מפתח = תאריך "YYYY-MM-DD"
    "2025-01-05": {
      day: "A",                     // A | B | C
      ex: { a1: [ {w:"40", r:"10", done:true}, null, ... ] }
    }
  },
  ui:   { view: "A" | "B" | "C" | "H", open: { [exerciseId]: boolean } },
  game: null,                       // Phase 1+ (XP, דמות, קרב) — נשמר ומיוצא כבר עכשיו
  meta: { legacyImported, legacyImportedAt?, createdAt, updatedAt }
}
```

משקלים וחזרות נשמרים כמחרוזות, בדיוק כמו במקור. חורים במערך הסטים נשמרים
כ‑`null` כדי לשמר את המבנה הישן במדויק.

### יומן אירועים (append‑only)

כל פעולה משמעותית נרשמת כאירוע `{ id: uuid, ts: epochMs, type, payload }`
ונשמרת לצד תמונת המצב. זה מה שיאפשר בעתיד סנכרון בין מכשירים בלי כתיבה מחדש.

| סוג | נרשם מתי |
|---|---|
| `set_logged` | הוקלד משקל/חזרות |
| `set_completed` / `set_uncompleted` | סומן/בוטל סימון של סט |
| `workout_finished` | כל הסטים של כל התרגילים ביום סומנו (פעם אחת ליום) |
| `legacy_import` | סיכום ייבוא `hyp3_data_v1` |
| `session_imported` | אימון היסטורי שיובא — כולל כל הסטים, עם `ts` של תאריך האימון |
| `data_imported` / `data_cleared` | ייבוא קובץ JSON / מחיקת הכול |
| `xp_gained`, `level_up`, `pr_achieved`, `battle_won`, `boss_defeated`, `item_equipped` | שמורים ל‑Phase 1+ |

`rebuildFromEvents(events)` בונה מחדש את המצב מהיומן בלבד (דטרמיניסטי, ממוין
לפי `ts`). Phase 1 ואילך ירחיבו אותו כדי לבנות מחדש גם את `state.game`.

### מיגרציה מהאפליקציה הישנה

בטעינה הראשונה, אם קיים `hyp3_data_v1`, הוא מיובא **ללא אובדן**: כל תאריך, אות
יום, מזהה תרגיל, סט (כולל חורים), משקל, חזרות ודגל `done`. במקביל נוצר אירוע
`session_imported` לכל אימון עם כל נתוני הסטים ו‑`ts` של תאריך האימון — כך
ש‑Phase 1 יוכל להעניק XP רטרואקטיבי פשוט על ידי replay של היומן, בסדר כרונולוגי.
המפתחות הישנים נשמרים כרשת ביטחון.

### ייצוא / ייבוא JSON

הייצוא כותב:

```jsonc
{
  "format": "gym-rpg-export",
  "schemaVersion": 1,
  "exportedAt": 1700000000000,
  "state":  { /* AppState מלא, כולל game */ },
  "events": [ /* יומן האירועים */ ],
  "sessions": { /* מראה לתאימות לאחור עם האפליקציה הישנה */ }
}
```

הייבוא מקבל **את שני הפורמטים**: את הבלוב החדש, וגם קובץ ישן בצורת
`{ "sessions": { ... } }`.

### חלוקת קבוצות שריר (`bodyPart`)

לכל תרגיל נוסף שדה `bodyPart` (`chest`/`back`/`legs`/`shoulders`/`arms`/`core`),
ובחלק מהתרגילים גם `split` — פיצול XP בין שתי קבוצות (למשל מקבילים: חזה 70%,
ידיים 30%). `bodyPartWeights(exercise)` מחזיר משקלים מנורמלים שסכומם 1.
Phase 1 יצרוך את זה לחישוב XP לכל איבר.

---

## אילוצים שנשמרים

* 100% אופליין — אין רשת, פונטים חיצוניים, CDN או קבצי אודיו. הצליל מסונתז
  ב‑Web Audio (ארפג׳ו 880 / 1108.7 / 1318.5 Hz).
* עברית ראשית, `dir="rtl"`, כותרות משנה באנגלית לתרגילים.
* Design tokens מקוריים: `#121824` / `#1E2638` / `#3B82F6` / `#10B981` / `#F59E0B`.
* Mobile‑first, יעדי מגע ≥ 40px, כבוד ל‑`prefers-reduced-motion`,
  ריווח תחתון לטיימר הצף.
* `strict: true` ב‑TypeScript, ללא `any` במודולי ה‑core.

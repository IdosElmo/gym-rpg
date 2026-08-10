# Gym RPG 💪

אפליקציית אימוני היפרטרופיה (3 ימים · A/B/C) בעברית, RTL, **100% אופליין** —
עם תשתית לשכבת משחק RPG שנבנית בשלבים הבאים.

> **סטטוס: Phase 1** — תשתית + מנוע XP, רמות לכל חלק גוף, רצף שבועי ומסך הדמות.
> מצב הקרב (אנרגיה, גלים, בוסים, ציוד) נוסף ב‑Phase 2‑3.

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
  core/xp.ts             # נוסחאות XP, רמות, רצפים, reducer של אירועי המשחק (טהור)
  core/game.ts           # חיבור המנוע ל-DataStore: הענקת XP/אנרגיה, רענון רצף
  core/combat.ts         # (Phase 2) לולאת קרב דטרמיניסטית
  core/balance.ts        # קבועי איזון — מקור אמת יחיד למספרים
  ui/character.ts        # מסך "דמות": SVG, פסי התקדמות, רצף, מצייני מקום לציוד
  ui/characterSvg.ts     # בניית ה-SVG השכבתי (טהור) — פרופורציות לפי רמות
  ui/xpfx.ts             # אנימציות "+XP חזה!" הצפות
  ui/                    # מסכים: workout, character, history, timer, toast, app shell
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
  schemaVersion: 2,                 // v2: שדה game קיבל טיפוס אמיתי (Phase 1)
  sessions: {                       // מפתח = תאריך "YYYY-MM-DD"
    "2025-01-05": {
      day: "A",                     // A | B | C
      ex: { a1: [ {w:"40", r:"10", done:true}, null, ... ] }
    }
  },
  ui:   { view: "A" | "B" | "C" | "CH" | "H", open: { [exerciseId]: boolean } },
  game: {                           // GameState — ראו "שכבת המשחק" למטה
    version: 1,
    parts: { chest: {xp, level}, back: …, legs: …, shoulders: …, arms: …, core: … },
    level, totalXp, energy, energyEarned, prCount,
    best:       { [exerciseId]: bestVolume },      // weight×reps הגבוה ביותר
    granted:    { "date|exId|setIndex": true },    // מנעול נגד חקלאות XP
    bonusDays:  { "YYYY-MM-DD": true },            // בונוס סיום אימון — פעם אחת ליום
    workoutDays: ["YYYY-MM-DD", …],                // ימי אימון חיים (בסיס הרצף)
    streak: { tier, weekStart, daysThisWeek, needed }
  },
  meta: { legacyImported, legacyImportedAt?, createdAt, updatedAt }
}
```

`game` הוא **מטמון**: אפשר לבנות אותו מחדש במלואו מיומן האירועים
(`rebuildGame`), ולכן בלוב לא מוכר פשוט נבנה מחדש במקום להישבר.

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
| `xp_gained` | כל הענקת XP — כולל הפיצול לחלקי גוף, `volume`, `factor`, `pr`, `retro` |
| `energy_gained` | אנרגיית קרב (10 לסט, 50 לסיום אימון) |
| `pr_achieved` | שיא אישי חדש בתרגיל |
| `level_up` / `streak_changed` | אינפורמטיביים (הרמה והדרגה **נגזרות**, ראו למטה) |
| `battle_won`, `boss_defeated`, `item_equipped` | שמורים ל‑Phase 2‑3 |

`rebuildFromEvents(events)` בונה מחדש את המצב מהיומן בלבד (דטרמיניסטי, ממוין
לפי `ts`), כולל `state.game` דרך `rebuildGame`. האפליקציה החיה וה‑replay מריצים
**בדיוק את אותו reducer על אותם אירועים** — יש בדיקות שמוכיחות שהתוצאה זהה.

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

---

## שכבת המשחק (Phase 1)

### חוקי XP (`core/xp.ts` — פונקציות טהורות + בדיקות)

| כלל | נוסחה |
|---|---|
| סיום סט | `10 × volumeFactor` |
| `volumeFactor` | `clamp((משקל×חזרות) / השיא הקודם, 0.5, 1.5)` — 1 כשאין עם מה להשוות |
| נפח לתרגילי משקל גוף/שניות | החזרות או השניות עצמן |
| שיא אישי חדש | `×2` XP + אירוע `pr_achieved` + toast חגיגי |
| סיום כל הסטים של כל התרגילים ביום | `+50` XP **לכל** חלק גוף + `+50` אנרגיית קרב |
| עקומת רמות | `xpForLevel(n) = 100 × 1.35^(n−1)` |
| רמת הדמות | `floor(ממוצע ששת רמות חלקי הגוף)` |
| אנרגיית קרב | `+10` לכל סט, `+50` לסיום אימון (נצברת ל‑Phase 2) |

הסט הראשון אי פעם בתרגיל **קובע** את השיא ולא נחשב שיא חדש (אין עם מה להשוות).

### רצף שבועי (Sun–Sat)

3 ימי אימון **שונים** בשבוע קלנדרי = "שבוע מושלם" → דרגה +1, בונוס קבוע ומצטבר
של `+10%` לכל הסטטיסטיקות. שבוע **סגור** עם פחות מ‑3 אימונים מוריד דרגה אחת
(רצפה 0). השבוע הנוכחי לעולם לא נשפט, ורמות/XP לעולם לא נלקחות.
הדרגה נגזרת מ‑`workoutDays` + התאריך של היום, ולכן שבוע שחלף מתעדכן גם בלי
פעולה של המשתמש (`refreshStreak` רץ בכל עלייה של האפליקציה).

### מניעת "חקלאות XP"

XP ואנרגיה מוענקים **פעם אחת לכל (תאריך, תרגיל, מספר סט)** — המפתח נשמר ב‑
`game.granted`. ביטול סימון של סט **לא** מחזיר XP, וסימון חוזר **לא** מעניק שוב.
כך כפתור ה‑✓ לא יכול לשמש כברז XP, ובלי לקנוס משתמש שתיקן טעות.
אותו רעיון לבונוס סיום האימון, שנשמר פעם אחת ליום ב‑`game.bonusDays`.

### XP רטרואקטיבי (`ensureGameState` ב‑`migrate.ts`)

בכל טעינה שבה `state.game` חסר או מגרסה לא מוכרת, ההיסטוריה הקיימת מקבלת XP:

1. ייבוא `hyp3_data_v1` שקרה עכשיו (אירועי `session_imported`);
2. משתמש שכבר ייבא ב‑Phase 0 (`legacyImported === true`, `game === null`);
3. אימונים שתועדו חי תחת Phase 0 (אירועי סטים בלי XP);
4. מצב עם אימונים אבל בלי יומן — האימונים "משוחזרים" כאירועי
   `session_imported` עם `source: "recovered"` לפני חישוב ה‑XP.

ההענקות עצמן נכתבות כאירועים ליומן (עם `ts` של תאריך האימון), כך שהמצב נשאר
פונקציה טהורה של היומן. הענקות רטרואקטיביות מסומנות `retro: true`:
הן משלמות XP ושיאים, אבל **לא** אנרגיית קרב ו**לא** ימי רצף — הרצף מתחיל מ‑0,
כפי שדורש המפרט. הפעולה אידמפוטנטית: הרצה שנייה לא מעניקה כלום.

### מסך הדמות (`דמות`)

* **SVG שכבתי** שהפרופורציות שלו נגזרות מרמות חלקי הגוף: חזה מרחיב את פלג הגוף
  העליון, גב מוסיף "כנפיים" (lats), כתפיים מרחיבות את מוטת הכתפיים והדלתות,
  ידיים מעבות את הזרועות, רגליים מעבות ירכיים ושוקיים, וליבה **מצרה** את המותן
  ומחדדת את שרירי הבטן. הגדילה חסומה (`BALANCE.character.visualMaxLevel`) כדי
  שהדמות תישאר מצוירת ומחויכת ולא מפלצתית.
* עלייה ברמה = הבהוב/פעימה קצרה על החלק שגדל (מכובד `prefers-reduced-motion`).
* לכל קבוצה יש `data-part`, ויש קבוצות ריקות `data-slot` (`gloves`/`belt`/
  `shoes`/`cape`) + `characterAnchors()` — נקודות החיבור לציוד של Phase 3.
* במסך: רמה ראשית, שישה פסי התקדמות (חזה, גב, רגליים, כתפיים, ידיים, ליבה),
  סטטיסטיקות לחימה נגזרות, דרגת רצף, ומצייני מקום לציוד ולגביעים.

### מסך האימון

`+XP חזה!` צף מעל כפתור ה‑✓ בכל סימון סט (אחד לכל חלק גוף שקיבל XP), מונה
אנרגיה שקט בפינת הכותרת, ו‑toast חגיגי לשיא אישי ולעליית רמה.

---

## אילוצים שנשמרים

* 100% אופליין — אין רשת, פונטים חיצוניים, CDN או קבצי אודיו. הצליל מסונתז
  ב‑Web Audio (ארפג׳ו 880 / 1108.7 / 1318.5 Hz).
* עברית ראשית, `dir="rtl"`, כותרות משנה באנגלית לתרגילים.
* Design tokens מקוריים: `#121824` / `#1E2638` / `#3B82F6` / `#10B981` / `#F59E0B`.
* Mobile‑first, יעדי מגע ≥ 40px, כבוד ל‑`prefers-reduced-motion`,
  ריווח תחתון לטיימר הצף.
* `strict: true` ב‑TypeScript, ללא `any` במודולי ה‑core.

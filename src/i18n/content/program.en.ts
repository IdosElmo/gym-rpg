/**
 * i18n/content/program.en.ts — the English overlay of data/program.ts.
 *
 * Keyed by the program's stable ids. `data/program.ts` itself is never edited
 * for a translation (the legacy parity test pins it byte-for-byte); every
 * screen reads exercise copy through `i18n/content.ts`, which consults this
 * map in English and falls back to the Hebrew original for anything missing.
 *
 * Voice: second person, imperative, short — the same coaching voice as the
 * Hebrew ("Set the bench to 30°.", "Common mistake: …"). Every entry is a
 * faithful translation of the Hebrew: same number of steps, same angles,
 * tempos and cues — no advice the Hebrew does not give.
 * tests/i18n.content.test.ts pins coverage and step counts.
 */

import type { BuiltInDayKey } from '../../data/program.ts';
import type { DayCopy, ExerciseCopy } from '../content.ts';

export const EXERCISE_EN: Readonly<Record<string, ExerciseCopy>> = {
  // ── Workout A ────────────────────────────────────────────────────────────
  a1: {
    name: 'Incline Press (Smith / Dumbbell)',
    muscle: 'Upper chest',
    steps: [
      'Set the bench to 30°.',
      'Pull your shoulder blades back and pin them to the bench; grip slightly wider than shoulder width.',
      'Lower the bar/dumbbells slowly (2–3 seconds) to your upper chest.',
      'Drive up explosively without locking your elbows.',
    ],
    cue: 'Drive your elbows slightly inward on the way up; control the stretch at the bottom.',
    mistake: 'Common mistake: over-arching your back, or lowering the bar toward your belly instead of your upper chest.',
  },
  a2: {
    name: 'One-Arm Dumbbell Row',
    muscle: 'Back width & thickness',
    steps: [
      'Place one knee and one hand on a flat bench.',
      'Keep your back straight and parallel to the floor.',
      'Pull the dumbbell toward your pants pocket (hip).',
      'Lower slowly to a full stretch.',
    ],
    cue: 'Pull with your elbow, not your biceps; your torso stays completely still.',
    mistake: "Common mistake: rotating your torso upward to 'help' the pull.",
  },
  a3: {
    name: 'Stationary Lunge / Split Squat',
    muscle: 'Quads & glutes',
    steps: [
      'Hold the dumbbells at your sides.',
      'Step forward into a stable stance.',
      'Drop straight down until your back knee almost touches the floor.',
      'Drive back up through your front heel.',
    ],
    cue: '70% of your bodyweight on the front leg; chest up throughout the movement.',
    mistake: 'Common mistake: the front knee caving inward, or leaning your torso forward.',
  },
  a4: {
    name: 'Dumbbell Chest Fly',
    muscle: 'Chest isolation & stretch',
    steps: [
      'Lie on a flat bench, elbows slightly bent.',
      'Open your arms out to the sides in a wide arc.',
      'Stop when you feel a stretch in your chest — no pain in the shoulder.',
      'Squeeze your chest and bring the weights back along the arc.',
    ],
    cue: 'Imagine hugging a wide tree trunk; a deep stretch with no pain in your shoulders.',
    mistake: 'Common mistake: straightening your elbows and turning the exercise into a press.',
  },
  a5: {
    name: 'Dumbbell Biceps Curl',
    muscle: 'Biceps',
    steps: [
      'Standing or seated, elbows tucked to your ribs and a neutral grip (thumbs up).',
      'Curl the dumbbell up in one smooth motion.',
      'Rotate your palm up (supination) as you lift.',
      'Lower slowly, under full control.',
    ],
    cue: 'Zero body swing; squeeze your biceps hard at the top.',
    mistake: 'Common mistake: swinging your torso and using momentum instead of the muscle.',
  },
  a6: {
    name: 'Hanging / Lying Leg & Knee Raise',
    muscle: 'Lower abs',
    steps: [
      'Hang from a pull-up bar or lie on a bench.',
      'Raise your knees/legs toward your chest.',
      'Curl your pelvis slightly up at the end of the movement.',
      'Lower slowly, without swinging.',
    ],
    cue: 'Curl your pelvis toward your chest at the top of the movement.',
    mistake: 'Common mistake: swinging your legs with momentum instead of a controlled ab curl.',
  },

  // ── Workout B ────────────────────────────────────────────────────────────
  b1: {
    name: 'Flat Smith Machine Bench Press',
    muscle: 'Mid chest',
    steps: [
      'Lie under the Smith machine and grip the bar slightly wider than shoulder width.',
      'Unrack the bar and lower it under control to mid-sternum.',
      'Pause briefly and press up hard.',
      'Keep your feet planted on the floor.',
    ],
    cue: 'Shoulder blades pinned down and back for the whole set.',
    mistake: 'Common mistake: bouncing the bar off your chest, or your shoulder blades coming off the bench.',
  },
  b2: {
    name: 'Lat Pulldown / Pull-Up',
    muscle: 'Back width · V-taper',
    steps: [
      'Take a wide grip on the bar.',
      'Pull the bar to your upper chest.',
      'Drive your elbows down and back.',
      'Return slowly to a full stretch.',
    ],
    cue: 'Lead with your elbows; your chest rises to meet the bar.',
    mistake: 'Common mistake: pulling with your biceps and leaning back too far.',
  },
  b3: {
    name: 'Dips',
    muscle: 'Lower chest & triceps',
    steps: [
      'Support your bodyweight on the parallel bars.',
      'Lean your torso forward about 30° to emphasize the chest.',
      'Lower until your elbows are bent to 90°.',
      'Push back up powerfully.',
    ],
    cue: 'Lean forward = chest emphasis; upright torso = triceps emphasis.',
    mistake: 'Common mistake: going too deep, which overloads the shoulders.',
  },
  b4: {
    name: 'Bent-Over Row (Smith / Dumbbell)',
    muscle: 'Upper-back thickness',
    steps: [
      'Bend your knees slightly and hinge your hips back to a 45° angle.',
      'Keep your back completely straight.',
      'Pull the bar/dumbbells to the bottom of your sternum, elbows at 45° from your body.',
      'Lower slowly, under control.',
    ],
    cue: 'Squeeze your shoulder blades together at the peak contraction.',
    mistake: 'Common mistake: rounding your lower back, or pulling with your hands instead of your elbows.',
  },
  b5: {
    name: 'Plank (Weighted / Bodyweight)',
    muscle: 'Deep core',
    steps: [
      'Forearms on the mat, elbows directly under your shoulders, body in one straight line.',
      'Squeeze your glutes hard.',
      'Draw your navel in toward your spine.',
      'Breathe steadily throughout the hold.',
    ],
    cue: "Don't let your lower back sag; hold a rigid bridge.",
    mistake: 'Common mistake: hips raised too high, or a sagging pelvis.',
  },
  b6: {
    name: 'Cable Crossover',
    muscle: 'Mid & lower chest · isolation',
    steps: [
      'Grab the high-pulley handles, take a small step forward and lean your torso slightly.',
      'Keep a slight, fixed bend in your elbows throughout the movement.',
      'Bring your hands together in a wide arc until they meet in front of your belly.',
      'Return slowly to a full chest stretch.',
    ],
    cue: 'Squeeze your chest hard where your hands meet and hold for a second.',
    mistake: 'Common mistake: bending your elbows and turning the arc into a press.',
  },

  // ── Workout C ────────────────────────────────────────────────────────────
  c1: {
    name: 'Incline Dumbbell Bench Press',
    muscle: 'Upper chest · full range of motion',
    steps: [
      'Bench at a 30° incline.',
      'Lower the dumbbells deep — a bigger stretch than with the bar.',
      'Press up and slightly inward.',
      'Keep your shoulders pulled back.',
    ],
    cue: 'Full stretch at the bottom without your shoulders rolling forward.',
    mistake: 'Common mistake: knocking the dumbbells together hard at the top and losing tension on the chest.',
  },
  c2: {
    name: 'Romanian Deadlift (Dumbbell / Smith)',
    muscle: 'Hamstrings · glutes · spinal erectors',
    steps: [
      'Keep a slight, fixed bend in your knees.',
      'Hinge your hips back, back completely flat.',
      'Keep the dumbbells close to your shins all the way down.',
      'Drive your hips forward to stand tall.',
    ],
    cue: 'Push your glutes back toward the wall behind you; a completely neutral spine.',
    mistake: 'Common mistake: rounding your back, or bending your knees so it turns into a squat.',
  },
  c3: {
    name: 'Seated Dumbbell Shoulder Press',
    muscle: 'Front & side delts',
    steps: [
      'Bench at a steep 80–85° angle.',
      'Start with the dumbbells at ear height.',
      'Press up until your arms are fully straight.',
      'Lower under control back to ear height.',
    ],
    cue: "Brace your core; don't arch your lower back off the bench.",
    mistake: 'Common mistake: over-arching your back, which turns the press into an upper-chest press.',
  },
  c4: {
    name: 'Overhead Dumbbell Triceps Extension',
    muscle: 'Triceps · long head',
    steps: [
      'Seated or standing, hold one heavy dumbbell overhead with both hands.',
      'Bend your elbows and lower the dumbbell behind your head.',
      'Extend your arms straight up.',
      'Keep your elbows steady.',
    ],
    cue: 'Elbows tucked in and pointing forward — not flaring out to the sides.',
    mistake: 'Common mistake: flaring your elbows out to the sides, which takes the load off the long head.',
  },
  c5: {
    name: 'Decline / Weighted Crunch',
    muscle: 'Upper abs',
    steps: [
      'Decline bench or a mat, a light weight on your chest.',
      'Flex your spine — ribs move toward your pelvis.',
      'Hold the full contraction for a second.',
      'Lower slowly, under control.',
    ],
    cue: "Roll through your spine — don't pull with your neck or your hip flexors.",
    mistake: 'Common mistake: pulling your head with your hands, or raising your whole torso up stiff and straight.',
  },
  c6: {
    name: 'Weighted Russian Twist',
    muscle: 'Obliques · waist definition',
    steps: [
      'Sit on the mat, knees bent and heels close to the floor.',
      'Lean your torso back about 45° and keep your back straight.',
      'Hold a dumbbell in both hands and rotate your torso from side to side.',
      'Drive the rotation from your ribs — not your arms.',
    ],
    cue: 'Tuck your chin slightly and follow your hands with your eyes; the rotation is slow and controlled.',
    mistake: 'Common mistake: swinging only your arms quickly, without really rotating your torso.',
  },

  // ── Library (EXTRA_EXERCISES) ────────────────────────────────────────────
  x1: {
    name: 'Smith Machine Squat',
    muscle: 'Quads · glutes',
    steps: [
      'Set the bar on your traps and stand with your feet hip-width apart.',
      'Place your feet slightly in front of the bar line.',
      'Lower slowly until your thighs are parallel to the floor.',
      'Drive back up through mid-foot without locking your knees.',
    ],
    cue: 'Knees track over your toes; chest open all the way down.',
    mistake: 'Common mistake: bouncing out of the bottom, or lifting your heels off the floor.',
  },
  x2: {
    name: 'Leg Extension',
    muscle: 'Quads (isolation)',
    steps: [
      "Adjust the backrest so your knee lines up with the machine's pivot.",
      'Hold the handles and press your back into the backrest.',
      'Extend your knees until your legs are almost fully straight.',
      'Pause for a second in the squeeze, then lower slowly.',
    ],
    cue: "A short pause at the top — that's where your quads work hardest.",
    mistake: 'Common mistake: swinging the weight up with momentum and lifting your hips off the seat.',
  },
  x3: {
    name: 'Leg Curl',
    muscle: 'Hamstrings',
    steps: [
      'Lie or sit in the machine with the pad resting just above your Achilles tendon.',
      'Hold the handles and keep your hips pressed to the pad.',
      'Curl your knees forcefully to the end of the range.',
      'Return slowly, under control, without letting the tension go.',
    ],
    cue: 'Hips stay pinned — only the knee moves.',
    mistake: 'Common mistake: lifting your hips off the pad to help the movement.',
  },
  x4: {
    name: 'Dumbbell Lateral Raise',
    muscle: 'Side delts',
    steps: [
      'Stand with light dumbbells at your sides, elbows slightly bent.',
      'Raise your arms out to the sides up to shoulder height.',
      'Lead with your elbows, not your hands.',
      'Lower slowly, under full control.',
    ],
    cue: 'Imagine pouring water from a small jug at the top of the movement.',
    mistake: 'Common mistake: swinging your body and going too heavy, which shifts the work to your traps.',
  },
  x5: {
    name: 'Cable Rope Pushdown',
    muscle: 'Triceps',
    steps: [
      'Grab the rope on a high pulley, elbows tucked to your ribs.',
      'Lean your torso slightly forward and pin your elbows in place.',
      'Extend your elbows and spread the rope ends apart.',
      'Return slowly to a full bend.',
    ],
    cue: 'Only your forearms move — your elbows stay nailed to your ribs.',
    mistake: "Common mistake: leaning in with your whole body to push a weight that's too heavy.",
  },
  x6: {
    name: 'Close-Grip Lat Pulldown',
    muscle: 'Back width · biceps',
    steps: [
      'Grab a V-handle with a close, neutral grip.',
      'Sit tall and lock your knees under the pad.',
      'Pull the handle to your mid-chest, elbows back.',
      'Go back up slowly to a full lat stretch.',
    ],
    cue: 'Pull your elbows toward your pockets; your chest rises to meet the handle.',
    mistake: 'Common mistake: leaning far back, which turns the exercise into a row.',
  },
  x7: {
    name: 'Cable Face Pull',
    muscle: 'Rear delts · mid traps',
    steps: [
      'Set the pulley at face height and grab the rope with both hands.',
      'Step back until the cable is taut and your arms are extended.',
      'Pull the rope toward your forehead with your elbows high.',
      'Rotate your hands outward and squeeze your shoulder blades.',
    ],
    cue: 'Your elbows stay higher than your hands throughout the pull.',
    mistake: 'Common mistake: going too heavy, which drops your elbows and turns the exercise into a row.',
  },
  x8: {
    name: 'Dumbbell Shrug',
    muscle: 'Upper traps',
    steps: [
      'Stand with dumbbells at your sides, arms straight.',
      'Raise your shoulders straight up toward your ears.',
      'Hold for a second at the top squeeze.',
      'Lower slowly to a full trap stretch.',
    ],
    cue: 'Straight up and down only — no rolling your shoulders.',
    mistake: 'Common mistake: bending your elbows, which turns the exercise into an upright row.',
  },
  x9: {
    name: 'Hammer Curl',
    muscle: 'Biceps · brachioradialis',
    steps: [
      'Stand with dumbbells in a neutral grip (thumbs up).',
      'Keep your elbows tucked to your ribs.',
      'Curl up to shoulder height without rotating your palm.',
      'Lower slowly, under full control.',
    ],
    cue: "A fixed hammer grip — your palm doesn't rotate at all.",
    mistake: 'Common mistake: swinging your torso and heaving the dumbbells up with momentum.',
  },
  x10: {
    name: 'Dumbbell Pullover',
    muscle: 'Chest & lats · rib-cage expansion',
    steps: [
      'Lie on a flat bench and hold one dumbbell with both hands above your chest.',
      'Keep a slight, fixed bend in your elbows throughout the movement.',
      'Lower the dumbbell in a wide arc behind your head to a full stretch.',
      'Bring it back along the arc over your chest, squeezing your chest and lats.',
    ],
    cue: 'Hips stay down and ribs stay closed — the stretch is in your chest and lats, not your lower back.',
    mistake: 'Common mistake: bending your elbows on the way down, which turns the exercise into a triceps extension.',
  },
  x11: {
    name: 'Goblet Squat',
    muscle: 'Quads · glutes',
    steps: [
      'Hold one dumbbell vertically in both hands, against your chest and under your chin.',
      'Stand shoulder-width apart, toes turned slightly out.',
      'Lower slowly until your thighs are parallel to the floor, chest up the whole way down.',
      'Drive back up through mid-foot without locking your knees.',
    ],
    cue: 'The dumbbell stays against your chest and your elbows drop between your knees.',
    mistake: 'Common mistake: heels lifting off the floor, or leaning forward so the dumbbell drifts away from your body.',
  },
  x12: {
    name: 'Flat Dumbbell Bench Press',
    muscle: 'Mid chest',
    steps: [
      'Lie on a flat bench, a dumbbell in each hand at chest level.',
      'Pull your shoulder blades back and pin them to the bench.',
      'Press the dumbbells up and slightly inward to just short of lockout.',
      'Lower slowly (2–3 seconds) to a comfortable chest stretch.',
    ],
    cue: 'Feet planted on the floor; the dumbbells travel in a straight line over your chest.',
    mistake: 'Common mistake: over-arching your back, or bouncing the dumbbells up and losing tension on the chest.',
  },
  x13: {
    name: 'Dead Hang',
    muscle: 'Grip · spinal decompression',
    steps: [
      'Grab the pull-up bar with a grip slightly wider than shoulder width.',
      'Relax your body completely and let your weight stretch your spine downward.',
      'Breathe slowly and steadily throughout the hold.',
      "When time is up, step down gently — don't jump.",
    ],
    cue: 'Shoulders relaxed all the way up to your ears — this is a passive hang to decompress, not a pull.',
    mistake: 'Common mistake: shrugging your shoulders and holding tension in your body instead of relaxing fully.',
  },
  x14: {
    name: 'Assisted Pull-Up (Band / Machine)',
    muscle: 'Back width',
    steps: [
      'Anchor a band on the bar and put a knee or foot in it, or set the counterweight on the assisted pull-up machine.',
      'Grip the bar slightly wider than your shoulders and pull your shoulder blades down before you pull.',
      'Pull your chin over the bar in a slow, controlled motion.',
      'Lower slowly until your arms are almost straight.',
    ],
    cue: 'Lead with your elbows down; your chest rises to meet the bar.',
    mistake: 'Common mistake: too much help from the band, and fast reps with no control on the way down.',
  },
  x15: {
    name: 'Seated Cable Row',
    muscle: 'Back thickness · mid traps',
    steps: [
      'Sit facing the low pulley, feet on the footrests and knees slightly bent.',
      'Grab the handle (neutral or wide) with a straight back and an open chest.',
      'Pull the handle to your lower belly and squeeze your shoulder blades together all the way.',
      'Return slowly to a full stretch without rounding your back.',
    ],
    cue: 'Chest out, and squeeze your shoulder blades as hard as you can at the end of every pull.',
    mistake: 'Common mistake: rocking your torso back and pulling with your arms instead of your back.',
  },
  x16: {
    name: 'Pallof Press',
    muscle: 'Core · anti-rotation',
    steps: [
      'Stand side-on to the pulley with the cable at chest height, holding the handle in both hands in front of your sternum.',
      'Step sideways until the cable is taut; feet shoulder-width apart and core braced.',
      'Press your hands straight out from your chest — without letting your torso rotate toward the machine.',
      'Bring them back slowly to your chest, hips and shoulders still square to the front.',
    ],
    cue: "Your hands move — your torso stays completely still; that's the whole point of the exercise.",
    mistake: 'Common mistake: letting your shoulders or hips rotate after your hands instead of resisting the pull.',
  },
  x17: {
    name: 'Negative Pull-Up',
    muscle: 'Back width',
    steps: [
      'Jump (or step up from a bench) into the top position — chin over the bar.',
      'Hold for a second at the top with your shoulder blades squeezed.',
      'Lower as slowly as you can — 4–5 seconds through the full range.',
      'Reach almost full extension, let go, and get back up for the next rep.',
    ],
    cue: 'The descent is the exercise: fight for every inch on the way down.',
    mistake: 'Common mistake: free-falling through the bottom half instead of a controlled descent all the way.',
  },
  x18: {
    name: 'Chest-Supported Dumbbell Row',
    muscle: 'Upper back · no lower-back load',
    steps: [
      'Set a bench to a 30–45° incline and lie face down on it, chest supported at the top of the pad.',
      'Put your feet on the floor and let your arms hang with the dumbbells.',
      'Pull the dumbbells to your ribs, elbows close to your body and shoulder blades squeezing.',
      'Lower slowly to a full stretch without lifting your chest off the pad.',
    ],
    cue: 'Your chest stays on the pad — that keeps your lower back out of the equation.',
    mistake: "Common mistake: lifting your torso off the bench at the end of the pull to 'help' with momentum.",
  },
  x19: {
    name: 'Medium-Grip Lat Pulldown',
    muscle: 'Back width',
    steps: [
      'Grip the bar at shoulder width or slightly wider, palms facing forward.',
      'Sit tall with your knees under the pad.',
      'Pull the bar to your upper sternum, elbows down and back.',
      'Go back up slowly to a full lat stretch.',
    ],
    cue: 'Only a slight lean back — the pull starts from your elbows, not your forearms.',
    mistake: 'Common mistake: leaning far back and pulling the bar to your belly.',
  },
  x20: {
    name: 'One-Arm Cable Row',
    muscle: 'Back thickness · side-to-side balance',
    steps: [
      'Stand facing a pulley set at belly height and grab the handle with one hand, neutral grip.',
      'Rest your free hand on your thigh; back straight and chest open.',
      'Pull the handle to your ribs, driving your elbow back close to your body.',
      'Return slowly to a full stretch, without rotating your torso.',
    ],
    cue: 'Your shoulder blade starts the pull; your torso stays stable and facing forward the whole time.',
    mistake: 'Common mistake: twisting your torso back along with the pull instead of letting your back do clean work.',
  },
  x21: {
    name: 'Treadmill Incline Walk',
    muscle: 'Cardio · glutes & calves',
    steps: [
      'Start with a comfortable walk (5–6 km/h) at a 1% incline, without holding the handrail.',
      'Every 5 minutes raise the incline by one point — the pace stays the same.',
      "Tap ✓ at the end of each stage: the next stage's timer starts on its own, and with it the new incline.",
      'A full heel-to-toe stride, torso upright and eyes forward — not on the display.',
    ],
    cue: 'Push off from your glutes on every step; if you need the handrail to keep the pace, the incline is too high.',
    mistake: 'Common mistake: hanging on the handrail and leaning back — it cancels the incline you came for.',
    loadLabel: 'Incline',
  },
  x22: {
    name: 'Stationary Bike — Zone 2 (2 h)',
    muscle: 'Cardio · legs',
    steps: [
      'Set the saddle height so your knee stays slightly bent at the bottom of the pedal stroke.',
      'Ride at 80–90 rpm against a resistance that keeps your heart rate at 60–70% of max — you can talk in full sentences.',
      "Tap ✓ at the end of every 10 minutes: the next stage's timer starts on its own, and the power stays the same.",
      'Drink every 20 minutes; torso relaxed, shoulders away from your ears and hands resting on the handlebars without leaning on them.',
    ],
    cue: "If you're panting, slow down; Zone 2 is the pace you can hold for two hours without fighting for it.",
    mistake: 'Common mistake: starting too hard and drifting into Zone 3 after half an hour — two slow hours are worth more than one fast hour.',
    loadLabel: 'Power',
  },
  x23: {
    name: 'Stationary Bike — VO2 Max Intervals (4×4)',
    muscle: 'Cardio · legs',
    steps: [
      'Warm up easy for 10 minutes before the first stage; tap ▶ when you start pushing.',
      'Pedal for 4 minutes against a resistance that brings your heart rate to 90–95% of max by the end of the second minute — hard, not a sprint.',
      'When the 4 minutes are up, drop to an easy resistance for 3 minutes of recovery, and tap ✓ only when you start the next interval.',
      'Hold the same power through all four stages; if the fourth falls far below the first, the power was too high.',
    ],
    cue: "The last minute of each interval is the one that builds VO2 max — don't give it up.",
    mistake: 'Common mistake: sprinting the first minute and running out by the second — the power should stay even across all 4 minutes.',
    loadLabel: 'Power',
  },
  x24: {
    name: 'Dumbbell Clean and Press',
    muscle: 'Shoulders · legs · back',
    steps: [
      'Stand shoulder-width apart, a dumbbell in each hand beside your shins, hips back and back flat.',
      'Drive through your legs and snap your hips open; the dumbbells travel up close to your body, elbows leading up.',
      'Catch the dumbbells on your shoulders (the "rack") with your elbows forward and soft knees.',
      'Press the dumbbells straight overhead to full extension, then lower under control — first to your shoulders, then to your shins.',
    ],
    cue: 'The power for the clean comes from your legs and hips, not your arms — your hands just guide the dumbbells up.',
    mistake: 'Common mistake: bending your elbows early and turning the clean into a heavy curl, or arching your lower back on the press.',
  },
  x25: {
    name: 'Dead Bug',
    muscle: 'Deep core · pelvic stability',
    steps: [
      'Lie on your back, arms straight up to the ceiling, thighs vertical and knees at 90 degrees.',
      'Press your lower back into the mat and exhale — this is the point you must not lose.',
      'Slowly lower one arm behind your head and the opposite leg forward, until they almost touch the floor.',
      'Return to the middle and switch sides; the other arm and leg stay exactly where they are.',
    ],
    cue: "Arm and leg move — your lower back and pelvis don't budge a millimeter.",
    mistake: 'Common mistake: your lower back arches and lifts off the mat as the leg lowers — lower it less, not faster.',
  },
  x26: {
    name: 'Side Plank',
    muscle: 'Obliques · lateral stability',
    steps: [
      'Lie on your side, elbow directly under your shoulder and forearm on the mat, feet stacked.',
      'Lift your hips until your body is one straight line from head to heels.',
      'Top hand on your hip or straight up to the ceiling; eyes forward, not down.',
      'Hold for the time and breathe — then switch sides without resting.',
    ],
    cue: "Push the floor away with your elbow and lift your hips — don't let them sag.",
    mistake: 'Common mistake: hips sagging backward or the shoulder pushed up into the ear — your body must stay in one plane.',
  },
  x27: {
    name: 'Bird Dog',
    muscle: 'Core · spinal erectors · glutes',
    steps: [
      'On all fours: hands under your shoulders, knees under your hips, back flat and eyes on the floor.',
      "Reach one arm forward and the opposite leg back at the same time, until they're in line with your torso.",
      'Pause for a second, squeeze your glutes, and return slowly without resting on the floor.',
      'Switch sides; your hips and shoulders stay parallel to the floor throughout the movement.',
    ],
    cue: "Imagine a glass of water on your lower back — it doesn't spill.",
    mistake: 'Common mistake: lifting the leg higher than your hips and arching your back, or rotating your hips to the side.',
  },
  x28: {
    name: 'Bulgarian Split Squat',
    muscle: 'Quads · glutes',
    steps: [
      'Stand with your back to the bench and rest your back foot on the pad; front foot a big step forward.',
      'Dumbbells at your sides, torso upright, core braced.',
      'Drop straight down until your front thigh is parallel to the floor and your back knee almost touches it.',
      'Drive back up through your whole front foot; finish all the reps, then switch legs.',
    ],
    cue: 'The weight is on your front leg — the back leg only keeps your balance.',
    mistake: 'Common mistake: a step too short, which pushes your front knee far past your toes, or leaning forward.',
  },
  x29: {
    name: 'Single-Leg Romanian Deadlift',
    muscle: 'Hamstrings · glutes · stability',
    steps: [
      'Stand on one leg with a soft knee, a dumbbell in each hand (or one in the hand opposite the standing leg).',
      'Hinge your torso forward from the hips and raise your free leg behind you, so torso and leg form one straight line.',
      'Lower until the dumbbells reach mid-shin and your back is still flat.',
      'Squeeze your glutes and drive your hips forward back to standing; finish the reps, then switch legs.',
    ],
    cue: 'Hips parallel to the floor — the toes of your raised leg point down, not to the side.',
    mistake: 'Common mistake: opening your hips to the side, or rounding your back to reach lower.',
  },
  x30: {
    name: 'Push-Up',
    muscle: 'Chest · triceps · core',
    steps: [
      'Hands on the floor slightly wider than your shoulders, in line with them; your body one straight line from head to heels.',
      'Squeeze your glutes and core, and lower under control with your elbows angling back at about 45 degrees.',
      'Lower until your chest almost touches the floor — about a fist above it.',
      'Push the floor away back up to full extension, without losing the straight line.',
    ],
    cue: "Imagine pushing the floor away from you — your body rises as one unit, your hips don't lag behind.",
    mistake: "Common mistake: hips sagging or hiking up, or half reps — your head gets close to the floor but your chest doesn't.",
  },
  x31: {
    name: 'Diamond Push-Up',
    muscle: 'Triceps · inner chest',
    steps: [
      'Bring your hands together under your mid-chest, so your thumbs and index fingers form a diamond.',
      'Body in a straight line, elbows tucked to your ribs and pointing back — not out to the sides.',
      'Lower under control until your chest touches the backs of your hands.',
      'Press back up, squeezing your triceps; your elbows stay close to your body.',
    ],
    cue: "Your elbows slide back along your ribs — that's what shifts the work to the triceps.",
    mistake: 'Common mistake: elbows flaring out to the sides, or shoulders shrugging up to your ears at the bottom.',
  },
  x32: {
    name: 'Wide Push-Up',
    muscle: 'Chest · front delts',
    steps: [
      'Place your hands about twice shoulder width apart, in line with your upper chest, fingers pointing slightly out.',
      'Body in a straight line, shoulder blades pulled slightly back.',
      'Lower under control with your elbows opening to the sides, until your chest is a fist above the floor — a shorter range than a regular push-up.',
      "Press back up, squeezing your chest; don't slam your elbows into lockout.",
    ],
    cue: 'Spread the floor apart with your palms — that keeps your chest working and your shoulders stable.',
    mistake: 'Common mistake: going too deep with a wide hand position and loading the front of your shoulder, or hips dropping.',
  },
  x33: {
    name: 'Hollow Body Hold',
    muscle: 'Deep core · abs',
    steps: [
      'Lie on your back and press your lower back into the mat — the whole exercise is about keeping it there.',
      'Lift your shoulder blades and legs off the mat, legs straight and toes pointed; arms straight overhead.',
      'Your body forms a shallow arc, chin slightly tucked, eyes on your knees.',
      'Hold for the time and breathe; the lower your legs and arms, the harder it gets.',
    ],
    cue: 'Press your lower back into the mat as if erasing the gap beneath it.',
    mistake: 'Common mistake: your lower back arches and lifts off the mat — raise your legs higher until it stays down.',
  },
  x34: {
    name: 'Pike Plank',
    muscle: 'Core · shoulders',
    steps: [
      'High plank: hands under your shoulders, body in one straight line, toes on a towel/sliders or dragging along the floor.',
      'Pull your hips up and your toes toward your hands, legs straight, until your body is an inverted V with your shoulders over your hands.',
      'Pause for a second at the top with your abs squeezed.',
      'Slide your toes back to plank under control, without letting your hips sag.',
    ],
    cue: 'Your hips rise toward the ceiling — your abs lift your legs, not your arms.',
    mistake: 'Common mistake: bending your knees instead of lifting your hips, or hips dropping below your body line on the way back to plank.',
  },
  x35: {
    name: 'Dumbbell Hex Press',
    muscle: 'Inner chest · triceps',
    steps: [
      'Lie on a flat bench, a dumbbell in each hand in a neutral grip (palms facing each other), and press the dumbbells together over your chest.',
      'Lower slowly to mid-chest with your elbows tucked to your ribs — the dumbbells stay together the whole way.',
      'Squeeze the dumbbells into each other and press up in a straight line to just short of lockout.',
      'Pause for a second at the top with your chest squeezed, then lower again under control (2–3 seconds).',
    ],
    cue: "Squeezing the dumbbells together is the exercise — don't let up for a moment, even on the way down.",
    mistake: 'Common mistake: the dumbbells drifting apart on the way up, or elbows flaring away from your body, which turns it into a regular chest press.',
  },
};

/** The built-in days' header lines. */
export const DAY_EN: Readonly<Partial<Record<BuiltInDayKey, DayCopy>>> = {
  A: {
    day: 'Sunday',
    label: 'Workout A',
    dur: '~50 min',
    focus: 'Upper chest · back width · legs · biceps · lower abs',
  },
  B: {
    day: 'Tuesday',
    label: 'Workout B',
    dur: '~50 min',
    focus: 'Mid & lower chest · back width · back thickness · deep core',
  },
  C: {
    day: 'Thursday',
    label: 'Workout C',
    dur: '~50 min',
    focus: 'Upper chest (full range) · posterior chain · shoulders · triceps · upper abs',
  },
};

/**
 * Word-level map for the 🎯 muscle badge, keyed by the exact Hebrew string the
 * program (and the custom-exercise picker) uses. Consulted when an exercise
 * has no `muscle` of its own in `EXERCISE_EN` — i.e. for custom exercises.
 */
export const MUSCLE_EN: Readonly<Record<string, string>> = {
  // The custom-exercise editor stores its primary body part's name
  // (`BODY_PART_HE`) as the muscle.
  'חזה': 'Chest',
  'גב': 'Back',
  'רגליים': 'Legs',
  'כתפיים': 'Shoulders',
  'ידיים': 'Arms',
  'ליבה': 'Core',
  // Every muscle string in data/program.ts.
  'חזה עליון': 'Upper chest',
  'גב רחב ועובי גב': 'Back width & thickness',
  'ארבע־ראשי וישבן': 'Quads & glutes',
  'בידוד ומתיחת חזה': 'Chest isolation & stretch',
  'יד קדמית': 'Biceps',
  'בטן תחתונה': 'Lower abs',
  'חזה מרכזי': 'Mid chest',
  'רוחב גב · V-Taper': 'Back width · V-taper',
  'חזה תחתון ויד אחורית': 'Lower chest & triceps',
  'עובי גב עליון': 'Upper-back thickness',
  'ליבה עמוקה': 'Deep core',
  'חזה מרכזי ותחתון · בידוד': 'Mid & lower chest · isolation',
  'חזה עליון · טווח תנועה מלא': 'Upper chest · full range of motion',
  'ירך אחורית · ישבן · זוקפי גב': 'Hamstrings · glutes · spinal erectors',
  'כתף קדמית וצידית': 'Front & side delts',
  'יד אחורית · הראש הארוך': 'Triceps · long head',
  'בטן עליונה': 'Upper abs',
  'אלכסוני הבטן · חיטוב המותן': 'Obliques · waist definition',
  'ארבע־ראשי · ישבן': 'Quads · glutes',
  'ארבע־ראשי (בידוד)': 'Quads (isolation)',
  'ירך אחורית': 'Hamstrings',
  'כתף צידית': 'Side delts',
  'יד אחורית': 'Triceps',
  'רוחב גב · יד קדמית': 'Back width · biceps',
  'כתף אחורית · טרפז אמצעי': 'Rear delts · mid traps',
  'טרפז עליון': 'Upper traps',
  'יד קדמית · ברכיורדיאליס': 'Biceps · brachioradialis',
  'חזה ורחב גבי · הרחבת בית החזה': 'Chest & lats · rib-cage expansion',
  'אחיזה · שחרור עמוד השדרה': 'Grip · spinal decompression',
  'רוחב גב': 'Back width',
  'עובי גב · טרפז אמצעי': 'Back thickness · mid traps',
  'ליבה · ייצוב נגד פיתול': 'Core · anti-rotation',
  'גב עליון · ללא עומס על הגב התחתון': 'Upper back · no lower-back load',
  'עובי גב · איזון בין הצדדים': 'Back thickness · side-to-side balance',
  'קרדיו · ישבן ושוקיים': 'Cardio · glutes & calves',
  'קרדיו · רגליים': 'Cardio · legs',
  'כתפיים · רגליים · גב': 'Shoulders · legs · back',
  'ליבה עמוקה · ייצוב אגן': 'Deep core · pelvic stability',
  'אלכסונים · ייצוב צידי': 'Obliques · lateral stability',
  'ליבה · זוקפי גב · ישבן': 'Core · spinal erectors · glutes',
  'ירך אחורית · ישבן · ייצוב': 'Hamstrings · glutes · stability',
  'חזה · טרייספס · ליבה': 'Chest · triceps · core',
  'טרייספס · חזה פנימי': 'Triceps · inner chest',
  'חזה · כתפיים קדמיות': 'Chest · front delts',
  'ליבה עמוקה · בטן': 'Deep core · abs',
  'ליבה · כתפיים': 'Core · shoulders',
  'חזה פנימי · יד אחורית': 'Inner chest · triceps',
};

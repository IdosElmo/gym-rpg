/**
 * i18n/content/leaguePools.en.ts — the English overlay of data/leaguePools.ts.
 *
 * Keyed by the pools' STABLE item ids — couple (`base_n`, `gift_MM_n`,
 * `exp_MM_n`, `chl_MM_n`) and personal (`p_`-prefixed) alike. data/leaguePools.ts
 * stays Hebrew and untouched; read through `i18n/leagueText.ts`, never
 * directly. A missing entry falls back to the Hebrew original
 * (tests/league.prizes.test.ts pins that none is missing).
 *
 * Display only: the ledger stores an id, a kind and a price — never this text.
 */

export interface LeagueItemEn {
  readonly name: string;
  readonly detail: string;
}

export const LEAGUE_ITEMS_EN: Readonly<Record<string, LeagueItemEn>> = {
  /* ------------------------------------------------ couple: the base pool */
  base_1: { name: 'Two days off dishes', detail: 'The loser washes all the dishes, two days in a row.' },
  base_3: { name: 'A foot massage', detail: 'A devoted foot massage, twenty minutes at least.' },
  base_4: { name: 'A back massage', detail: "A full back massage, oil of the winner's choice." },
  base_5: { name: 'Coffee delivery from Aroma', detail: "The winner's usual coffee, delivered home, on the loser." },
  base_2: {
    name: 'A surprise date',
    detail: 'The loser plans a surprise date before the month ends — the destination stays secret until the last moment.',
  },
  base_6: { name: 'Quality time with your partner', detail: 'The winner decides, the loser pampers. No questions asked.' },
  base_7: { name: 'A thong for the event', detail: "The loser turns up to the next event in a thong. The game's honor demands it." },

  /* ------------------------------------------------ couple: January */
  gift_01_1: { name: 'Breakfast on the loser', detail: "A café of the winner's choice, on the first Saturday of the month" },
  gift_01_2: { name: 'A week off kitchen duty', detail: 'The loser does the dishes every evening for a whole week' },
  gift_01_3: { name: "Movie night, winner's pick", detail: 'Popcorn included, no complaints and no phones' },
  exp_01_1: { name: 'A sunrise hike', detail: 'Out before first light, coffee in a flask, a short trail' },
  exp_01_2: { name: 'A hammam or spa evening', detail: 'Two hours with no clock, on the loser' },
  chl_01_1: { name: '10 pull-ups in a row', detail: 'One clean set of 10 reps by the end of the month' },
  chl_01_2: { name: '3-minute plank', detail: 'One unbroken hold, no dropping' },
  chl_01_3: { name: '12 workouts this month', detail: 'Twelve logged training days, however they fall' },

  /* ------------------------------------------------ couple: February */
  gift_02_1: { name: 'Dinner at a restaurant', detail: 'The loser pays, the winner picks the place' },
  gift_02_2: { name: 'A ten-minute back rub', detail: 'Every evening, for a whole week' },
  gift_02_3: { name: 'Dessert from the best bakery', detail: "On the way home from the month's last workout" },
  exp_02_1: { name: 'A screen-free day', detail: 'A whole Saturday without phones, planned by the winner' },
  exp_02_2: { name: 'A trial class in a new sport', detail: 'Climbing, dancing, boxing — whatever the winner picks' },
  chl_02_1: { name: 'Bodyweight squat', detail: 'A set of 5 reps with a load equal to your body weight' },
  chl_02_2: { name: '100 push-ups in one day', detail: 'You may split them into sets across the day' },
  chl_02_3: { name: 'Three perfect weeks', detail: 'Three weeks this month that earn a 🔵' },

  /* ------------------------------------------------ couple: March */
  gift_03_1: { name: 'Breakfast on the loser', detail: 'Shakshuka, fresh bread, no rush' },
  gift_03_2: { name: 'A new pair of training socks', detail: 'The loser buys, the winner picks the colour' },
  gift_03_3: { name: 'DJ at the gym', detail: 'Two weeks of picking the workout music, no appeals' },
  exp_03_1: { name: 'A blossom picnic', detail: 'A blanket, a basket and an hour-long walk first' },
  exp_03_2: { name: 'A workout together outdoors', detail: "A park, after work, the winner's choice" },
  chl_03_1: { name: 'Run 5 km', detail: 'Non-stop, no walking in the middle' },
  chl_03_2: { name: '15 lunges per leg', detail: 'One unbroken set of 15 on each leg' },
  chl_03_3: { name: '14 workouts this month', detail: 'Fourteen logged training days' },

  /* ------------------------------------------------ couple: April */
  gift_04_1: { name: 'Breakfast on the loser', detail: 'Outdoors, in the sun, after a morning workout' },
  gift_04_2: { name: 'Spring cleaning', detail: 'The loser does the big round of the house alone' },
  gift_04_3: { name: 'A new water bottle', detail: "The big beautiful one, in the winner's colour" },
  exp_04_1: { name: 'A day hike', detail: 'A five-hour trail, the loser carries the bag' },
  exp_04_2: { name: 'An evening on the roof', detail: 'Food, blankets and two hours of not talking about work' },
  chl_04_1: { name: 'Climb 100 flights of stairs', detail: 'Accumulated over the month, on foot only' },
  chl_04_2: { name: '20 pull-ups in one workout', detail: 'Any number of sets, in the same workout' },
  chl_04_3: { name: 'Four weeks in a row', detail: 'Four weeks with a 🔵, none missed' },

  /* ------------------------------------------------ couple: May */
  gift_05_1: { name: 'Breakfast on the loser', detail: 'With good coffee, not from the machine' },
  gift_05_2: { name: 'A new training shirt', detail: 'The loser buys it, no asking the price' },
  gift_05_3: { name: 'A week of meal prep', detail: 'The loser cooks for two every evening' },
  exp_05_1: { name: 'A beach day', detail: 'Early in the morning, before the beach fills up' },
  exp_05_2: { name: 'A cooking night together', detail: 'A new recipe, the loser buys the ingredients' },
  chl_05_1: { name: 'Bench press 1.25× body weight', detail: 'One clean rep, with a spotter' },
  chl_05_2: { name: '200 sit-ups in a week', detail: 'Accumulated, any form' },
  chl_05_3: { name: '16 workouts this month', detail: 'Sixteen logged training days' },

  /* ------------------------------------------------ couple: June */
  gift_06_1: { name: 'Ice cream on the loser', detail: 'The big one, with the toppings' },
  gift_06_2: { name: 'Breakfast on the loser', detail: 'By the sea, early in the morning' },
  gift_06_3: { name: 'A whole shopping shift', detail: "The loser does the week's grocery run" },
  exp_06_1: { name: 'A night out of town', detail: "A cabin or a tent, the winner's choice" },
  exp_06_2: { name: 'Sunset on the beach', detail: 'Leave early, no schedule' },
  chl_06_1: { name: 'Swim 500 m', detail: 'Non-stop, in a pool or the sea' },
  chl_06_2: { name: '50 burpees in a row', detail: 'No break, at your own pace' },
  chl_06_3: { name: 'Three perfect weeks', detail: 'Three weeks this month that earn a 🔵' },

  /* ------------------------------------------------ couple: July */
  gift_07_1: { name: 'Breakfast on the loser', detail: 'After a Friday morning workout' },
  gift_07_2: { name: 'A protein shake all week', detail: 'The loser makes it and brings it' },
  gift_07_3: { name: 'New flip-flops', detail: 'For the summer, on the loser' },
  exp_07_1: { name: 'A pool day', detail: 'A lounger, shade and lunch on the loser' },
  exp_07_2: { name: 'An open-air cinema', detail: 'Tickets and snacks on the loser' },
  chl_07_1: { name: '10,000 steps on 20 days', detail: 'Twenty days this month, not necessarily in a row' },
  chl_07_2: { name: 'Deadlift 1.5× body weight', detail: 'One clean rep, straight back' },
  chl_07_3: { name: '14 workouts this month', detail: 'Fourteen logged training days, heat included' },

  /* ------------------------------------------------ couple: August */
  gift_08_1: { name: 'Breakfast on the loser', detail: 'Air-conditioned, long, no schedule' },
  gift_08_2: { name: 'A new gym towel', detail: "The big soft one, the winner's choice" },
  gift_08_3: { name: 'A week off taking out the trash', detail: 'The loser takes it all' },
  exp_08_1: { name: 'A fun day on the water', detail: 'A water park or kayaks, on the loser' },
  exp_08_2: { name: 'A stargazing night', detail: 'A drive out of town, a blanket and two quiet hours' },
  chl_08_1: { name: '12 pull-ups in a row', detail: 'One clean set of 12 reps' },
  chl_08_2: { name: '90-second side plank per side', detail: 'Both sides, in the same workout' },
  chl_08_3: { name: 'Four weeks in a row', detail: 'Four weeks with a 🔵, none missed' },

  /* ------------------------------------------------ couple: September */
  gift_09_1: { name: 'Breakfast on the loser', detail: 'A festive one, for the new year' },
  gift_09_2: { name: "A book of the winner's choice", detail: 'The loser buys it and brings it' },
  gift_09_3: { name: 'A week of coffee in bed', detail: 'The loser makes it and serves it' },
  exp_09_1: { name: 'A weekend trip up north', detail: 'One night, the loser plans everything' },
  exp_09_2: { name: 'A holiday meal together', detail: 'Cooking for two, no guests' },
  chl_09_1: { name: 'Run 10 km', detail: 'Non-stop, at an easy pace' },
  chl_09_2: { name: '300 push-ups in a week', detail: 'Accumulated over one week' },
  chl_09_3: { name: '16 workouts this month', detail: 'Sixteen logged training days' },

  /* ------------------------------------------------ couple: October */
  gift_10_1: { name: 'Breakfast on the loser', detail: "Outdoors, in autumn's first sweater" },
  gift_10_2: { name: 'New training gloves', detail: 'On the loser' },
  gift_10_3: { name: 'A screen-free evening', detail: 'The loser sets up a game, food and quiet' },
  exp_10_1: { name: 'A bike ride', detail: 'Thirty kilometres, coffee halfway' },
  exp_10_2: { name: 'A museum or an exhibition', detail: "The winner's choice, tickets on the loser" },
  chl_10_1: { name: 'Squat 1.25× body weight', detail: 'One clean rep, full depth' },
  chl_10_2: { name: 'Row 1000 m under 4 minutes', detail: 'Rowing machine, one attempt' },
  chl_10_3: { name: 'Three perfect weeks', detail: 'Three weeks this month that earn a 🔵' },

  /* ------------------------------------------------ couple: November */
  gift_11_1: { name: 'Breakfast on the loser', detail: 'A warm one, with soup if needed' },
  gift_11_2: { name: 'Warm socks and a towel', detail: 'A winter kit on the loser' },
  gift_11_3: { name: 'A week off laundry', detail: 'The loser folds everything' },
  exp_11_1: { name: 'A soup-and-games night', detail: 'The loser cooks, the winner picks the game' },
  exp_11_2: { name: 'A walk in the first rain', detail: 'An hour outside, then hot chocolate on the loser' },
  chl_11_1: { name: '15 dips in a row', detail: 'One clean set of 15 reps' },
  chl_11_2: { name: '20 days of movement', detail: 'Twenty days this month with a logged workout or walk' },
  chl_11_3: { name: 'Four weeks in a row', detail: 'Four weeks with a 🔵, none missed' },

  /* ------------------------------------------------ couple: December */
  gift_12_1: { name: 'Breakfast on the loser', detail: "The year's big one" },
  gift_12_2: { name: 'A year-end gift', detail: "Up to an agreed budget, the winner's choice" },
  gift_12_3: { name: 'A week of picking the menu', detail: 'The winner decides what we eat every evening' },
  exp_12_1: { name: 'A free weekend', detail: 'Two days with no chores, the loser covers everything' },
  exp_12_2: { name: 'A year-in-review evening', detail: "Wine, the year's photos and planning the next one" },
  chl_12_1: { name: 'Three new personal records', detail: 'Three different exercises by the end of the month' },
  chl_12_2: { name: 'Train on every day of the week', detail: 'Seven different weekdays over the month' },
  chl_12_3: { name: '18 workouts this month', detail: 'Eighteen logged training days' },

  /* ------------------------------------------------ personal: the base pool */
  p_base_1: { name: 'A cheat meal', detail: 'One meal without counting — whatever you crave, no guilt.' },
  p_base_2: { name: 'The good coffee', detail: 'A coffee from the best place around, without looking at the price.' },
  p_base_3: { name: 'A small piece of gear', detail: 'Socks, straps, a bottle — something small to make the next session better.' },
  p_base_4: { name: 'A pamper night in', detail: 'A bath, a face mask, a show — one evening just for you.' },
  p_base_5: { name: 'A professional massage', detail: 'An hour with a massage therapist — your muscles earned it.' },
  p_base_6: { name: 'A morning with no alarm', detail: 'One morning that starts when your body says so, with no plans until noon.' },
  p_base_7: { name: 'A solo outing', detail: 'A film, a gig or a game — one ticket, and the pick is all yours.' },

  /* ------------------------------------------------ personal: January */
  p_gift_01_1: { name: 'A new training journal', detail: 'A good notebook for the new year — for goals and records' },
  p_gift_01_2: { name: 'A beanie for outdoor sessions', detail: 'Warm, soft, in a colour you like' },
  p_gift_01_3: { name: 'Soup from the good place', detail: "A hot bowl after the week's coldest session" },
  p_exp_01_1: { name: 'A sauna after training', detail: "An hour of heat after the week's heaviest session" },
  p_exp_01_2: { name: 'A trial class', detail: "Yoga, Pilates or boxing — something you've always wanted to try" },
  p_chl_01_1: { name: '2-minute plank', detail: 'One unbroken hold before the month ends' },
  p_chl_01_2: { name: '12 workouts this month', detail: 'Twelve logged training days, however they fall' },
  p_chl_01_3: { name: 'A week without sweets', detail: 'Seven days in a row with no desserts' },

  /* ------------------------------------------------ personal: February */
  p_gift_02_1: { name: 'A thermos flask', detail: 'A hot drink waiting at the end of a morning session' },
  p_gift_02_2: { name: 'Breakfast out', detail: 'A café, a good book and no rush' },
  p_gift_02_3: { name: 'A foam roller', detail: 'To loosen your legs after leg day' },
  p_exp_02_1: { name: 'A spa evening', detail: 'Two hours of warm pool and hot tub' },
  p_exp_02_2: { name: 'A screen-free day', detail: 'A whole day off without your phone — a walk, a book, a nap' },
  p_chl_02_1: { name: '30 push-ups in a row', detail: 'One set, no stopping' },
  p_chl_02_2: { name: 'Three perfect weeks', detail: 'Three weeks this month that earn a 🔵' },
  p_chl_02_3: { name: 'Eight hours of sleep', detail: 'Ten nights this month with at least eight hours of sleep' },

  /* ------------------------------------------------ personal: March */
  p_gift_03_1: { name: 'Good running socks', detail: 'The kind that leaves no blisters' },
  p_gift_03_2: { name: 'A plant for home', detail: 'Something green that grows along with you' },
  p_gift_03_3: { name: 'A big fruit smoothie', detail: 'After training, with all the toppings' },
  p_exp_03_1: { name: 'A blossom picnic', detail: 'A blanket, good food and an hour in the park among the flowers' },
  p_exp_03_2: { name: 'A new trail', detail: "A whole morning on a trail you haven't walked yet" },
  p_chl_03_1: { name: 'Run 5 km', detail: 'Non-stop, no walking in the middle' },
  p_chl_03_2: { name: '20 jump squats', detail: 'One unbroken set' },
  p_chl_03_3: { name: '14 workouts this month', detail: 'Fourteen logged training days' },

  /* ------------------------------------------------ personal: April */
  p_gift_04_1: { name: 'A new water bottle', detail: 'The big one that reminds you to drink all day' },
  p_gift_04_2: { name: 'Sport earbuds', detail: 'Up to a budget you set in advance' },
  p_gift_04_3: { name: 'A meal at your favourite restaurant', detail: 'Alone or with friends — your treat to yourself' },
  p_exp_04_1: { name: 'A day hike', detail: 'A long trail, a light bag and no schedule' },
  p_exp_04_2: { name: 'An hour of climbing', detail: 'A climbing wall, one hour, burning forearms' },
  p_chl_04_1: { name: '5 pull-ups in a row', detail: 'One clean set of five reps' },
  p_chl_04_2: { name: 'Four weeks in a row', detail: 'Four weeks with a 🔵, none missed' },
  p_chl_04_3: { name: '10,000 steps on 15 days', detail: 'Fifteen days this month, not necessarily in a row' },

  /* ------------------------------------------------ personal: May */
  p_gift_05_1: { name: 'A new training shirt', detail: 'Breathable, comfy, in a colour that makes you want to train' },
  p_gift_05_2: { name: 'A crate of seasonal fruit', detail: 'Fresh fruit from the market, just for you' },
  p_gift_05_3: { name: 'Running sunglasses', detail: "Light, and they don't slip mid-run" },
  p_exp_05_1: { name: 'Outdoor morning yoga', detail: 'A class in the park or by the water' },
  p_exp_05_2: { name: 'Cook for yourself', detail: 'A new recipe and good ingredients — a meal just for you' },
  p_chl_05_1: { name: '200 push-ups in a week', detail: 'Accumulated over one week' },
  p_chl_05_2: { name: 'Stretch every day', detail: 'Ten minutes of stretching on twenty days this month' },
  p_chl_05_3: { name: '16 workouts this month', detail: 'Sixteen logged training days' },

  /* ------------------------------------------------ personal: June */
  p_gift_06_1: { name: 'A big ice cream', detail: 'Your scoops, all the toppings' },
  p_gift_06_2: { name: 'A running cap', detail: 'A good peak for the summer sun' },
  p_gift_06_3: { name: 'New swimwear', detail: 'For the summer you earned' },
  p_exp_06_1: { name: 'A day at the beach or a lake', detail: 'Early in the morning, before everyone arrives' },
  p_exp_06_2: { name: 'Sunset from a viewpoint', detail: 'Walk up to a high spot, then an hour of quiet' },
  p_chl_06_1: { name: 'Swim 500 m', detail: 'Non-stop, in a pool or open water' },
  p_chl_06_2: { name: '30 burpees in a row', detail: 'No break, at your own pace' },
  p_chl_06_3: { name: 'Three perfect weeks', detail: 'Three weeks this month that earn a 🔵' },

  /* ------------------------------------------------ personal: July */
  p_gift_07_1: { name: 'A cooling towel', detail: 'For training in the midsummer heat' },
  p_gift_07_2: { name: 'A new protein flavour', detail: "The bag you've always wanted to try" },
  p_gift_07_3: { name: 'Comfy slides', detail: 'To slip into right after training' },
  p_exp_07_1: { name: 'A pool day', detail: 'A lounger, shade and a good book — all day' },
  p_exp_07_2: { name: 'An open-air film', detail: 'A film under the stars, with popcorn' },
  p_chl_07_1: { name: '10,000 steps on 20 days', detail: 'Twenty days this month, not necessarily in a row' },
  p_chl_07_2: { name: 'Early bird', detail: 'Four workouts that start before 7 a.m.' },
  p_chl_07_3: { name: '14 workouts this month', detail: 'Fourteen logged training days, heat included' },

  /* ------------------------------------------------ personal: August */
  p_gift_08_1: { name: 'A new gym towel', detail: 'The big soft one' },
  p_gift_08_2: { name: 'A cold shake after every session', detail: 'For a whole week' },
  p_gift_08_3: { name: 'An insulated bottle', detail: 'Cold water even after two hours in the sun' },
  p_exp_08_1: { name: 'A day on the water', detail: 'Kayak, paddleboard or a water park — your call' },
  p_exp_08_2: { name: 'A night under the stars', detail: 'A drive out of town, a blanket and silence' },
  p_chl_08_1: { name: '1-minute side plank per side', detail: 'Both sides, in the same workout' },
  p_chl_08_2: { name: '8 pull-ups in a row', detail: 'One clean set of eight reps' },
  p_chl_08_3: { name: 'Four weeks in a row', detail: 'Four weeks with a 🔵, none missed' },

  /* ------------------------------------------------ personal: September */
  p_gift_09_1: { name: 'A new book', detail: 'One you picked, to read after training' },
  p_gift_09_2: { name: 'A new gym bag', detail: 'With a shoe pocket and room for everything else' },
  p_gift_09_3: { name: 'A celebratory breakfast', detail: 'For a new season — out, unhurried' },
  p_exp_09_1: { name: 'A short weekend away', detail: 'One night, a small bag and a morning trail' },
  p_exp_09_2: { name: 'A new workshop', detail: 'Cooking, photography or pottery — one evening of learning' },
  p_chl_09_1: { name: 'Run 10 km', detail: 'Non-stop, at an easy pace' },
  p_chl_09_2: { name: '300 push-ups in a week', detail: 'Accumulated over one week' },
  p_chl_09_3: { name: '16 workouts this month', detail: 'Sixteen logged training days' },

  /* ------------------------------------------------ personal: October */
  p_gift_10_1: { name: 'New training gloves', detail: 'A good grip for the cold season' },
  p_gift_10_2: { name: 'A warm hoodie', detail: 'For autumn sessions outdoors' },
  p_gift_10_3: { name: 'A screen-free evening', detail: 'A game, a book and tea — one quiet evening' },
  p_exp_10_1: { name: 'A long bike ride', detail: 'Thirty kilometres, coffee halfway' },
  p_exp_10_2: { name: 'A museum or an exhibition', detail: 'A whole afternoon, at your own pace' },
  p_chl_10_1: { name: 'Squat your body weight', detail: 'One clean rep, full depth' },
  p_chl_10_2: { name: 'Row 1000 m', detail: 'Under 4:30, one attempt' },
  p_chl_10_3: { name: 'Three perfect weeks', detail: 'Three weeks this month that earn a 🔵' },

  /* ------------------------------------------------ personal: November */
  p_gift_11_1: { name: 'Warm socks', detail: 'A small winter kit for hard-working feet' },
  p_gift_11_2: { name: 'A running windbreaker', detail: 'Light, packable and rain-proof' },
  p_gift_11_3: { name: 'Hot chocolate from the good place', detail: 'After a session in the rain' },
  p_exp_11_1: { name: 'Soup and a film', detail: 'A big pot of soup, a blanket and a film you picked' },
  p_exp_11_2: { name: 'A walk in the first rain', detail: 'An hour out in a good coat, then a hot shower' },
  p_chl_11_1: { name: '10 dips in a row', detail: 'One clean set of ten reps' },
  p_chl_11_2: { name: '20 days of movement', detail: 'Twenty days this month with a logged workout or walk' },
  p_chl_11_3: { name: 'Four weeks in a row', detail: 'Four weeks with a 🔵, none missed' },

  /* ------------------------------------------------ personal: December */
  p_gift_12_1: { name: 'A year-end gift to yourself', detail: 'Up to a budget you set in advance — something you really wanted' },
  p_gift_12_2: { name: 'New training shoes', detail: 'The old pair has done its job' },
  p_gift_12_3: { name: 'A holiday feast your way', detail: 'No counting and no apologies' },
  p_exp_12_1: { name: 'Two days off', detail: 'A weekend with no chores and no alarm' },
  p_exp_12_2: { name: 'A year-in-review evening', detail: 'Photos from the year, your records and goals for the next one' },
  p_chl_12_1: { name: 'Three new personal records', detail: 'Three different exercises by the end of the month' },
  p_chl_12_2: { name: 'Train on every day of the week', detail: 'Seven different weekdays over the month' },
  p_chl_12_3: { name: '18 workouts this month', detail: 'Eighteen logged training days' },
};
